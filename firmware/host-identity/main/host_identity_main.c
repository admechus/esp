#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "driver/uart.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecdsa.h"
#include "mbedtls/entropy.h"
#include "mbedtls/sha256.h"
#include "node_roles.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "protocol_commands.h"

#define APP_VERSION "0.1.0"
#define INPUT_BUFFER_SIZE 2048
#define IDENTITY_NAMESPACE "identity"
#define IDENTITY_PRIVATE_KEY "p256_priv"
#define IDENTITY_PUBLIC_KEY "p256_pub"
#define P256_PRIVATE_KEY_SIZE 32
#define P256_PUBLIC_KEY_SIZE 65
#define SHA256_SIZE 32
#define SIGNATURE_BUFFER_SIZE 80
#define HEX_STRING_SIZE(bytes) ((bytes) * 2 + 1)
#define CONSOLE_UART UART_NUM_0
#define CONSOLE_BAUD_RATE 115200

static const char *TAG = "host_identity";
static char s_line_buffer[INPUT_BUFFER_SIZE];
static char s_rx_buffer[64];

typedef struct {
    bool present;
    uint8_t private_key[P256_PRIVATE_KEY_SIZE];
    uint8_t public_key[P256_PUBLIC_KEY_SIZE];
} identity_record_t;

static void trim_line(char *line)
{
    size_t length = strlen(line);
    while (length > 0 && isspace((unsigned char) line[length - 1])) {
        line[length - 1] = '\0';
        length--;
    }
}

static esp_err_t serial_write_all(const char *data, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        int written = uart_write_bytes(CONSOLE_UART, data + offset, length - offset);
        if (written <= 0) {
            return ESP_FAIL;
        }
        offset += (size_t) written;
    }

    return uart_wait_tx_done(CONSOLE_UART, pdMS_TO_TICKS(5000));
}

static esp_err_t send_json(cJSON *root)
{
    char *encoded = cJSON_PrintUnformatted(root);
    if (encoded == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t result = serial_write_all(encoded, strlen(encoded));
    if (result == ESP_OK) {
        result = serial_write_all("\n", 1);
    }

    cJSON_free(encoded);
    return result;
}

static void send_error_response(int request_id, const char *error, const char *detail)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", false);
    cJSON_AddStringToObject(root, "error", error);
    if (detail != NULL) {
        cJSON_AddStringToObject(root, "detail", detail);
    }

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send error response");
    }
    cJSON_Delete(root);
}

static void send_ping_response(int request_id)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "result", "PONG");

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send ping response");
    }
    cJSON_Delete(root);
}

static const char *role_to_string(node_role_t role)
{
    switch (role) {
    case NODE_ROLE_IDENTITY:
        return "identity";
    case NODE_ROLE_GATEWAY:
        return "gateway";
    case NODE_ROLE_PEER:
        return "peer";
    case NODE_ROLE_RELAY:
        return "relay";
    case NODE_ROLE_WORKER:
        return "worker";
    case NODE_ROLE_OBSERVER:
        return "observer";
    default:
        return "unknown";
    }
}

static void send_info_response(int request_id)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "device", "esp32-host-identity");
    cJSON_AddStringToObject(root, "chip", "esp32");
    cJSON_AddStringToObject(root, "role", role_to_string(NODE_ROLE_IDENTITY));
    cJSON_AddStringToObject(root, "profile", "host-attached-node");
    cJSON_AddStringToObject(root, "version", APP_VERSION);
    cJSON_AddStringToObject(root, "transport", "uart0");
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(root, "capabilities", "PING,GET_INFO,GEN_IDENTITY,GET_PUBLIC_ID,SIGN_BYTES,SIGN_HASH");

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send info response");
    }
    cJSON_Delete(root);
}

static esp_err_t init_rng(mbedtls_entropy_context *entropy, mbedtls_ctr_drbg_context *ctr_drbg)
{
    int result = 0;
    static const char *personalization = "esp-messenger-host-identity";

    mbedtls_entropy_init(entropy);
    mbedtls_ctr_drbg_init(ctr_drbg);

    result = mbedtls_ctr_drbg_seed(
        ctr_drbg,
        mbedtls_entropy_func,
        entropy,
        (const unsigned char *) personalization,
        strlen(personalization));
    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_ctr_drbg_seed failed: -0x%04x", -result);
        mbedtls_ctr_drbg_free(ctr_drbg);
        mbedtls_entropy_free(entropy);
        return ESP_FAIL;
    }

    return ESP_OK;
}

static void free_rng(mbedtls_entropy_context *entropy, mbedtls_ctr_drbg_context *ctr_drbg)
{
    mbedtls_ctr_drbg_free(ctr_drbg);
    mbedtls_entropy_free(entropy);
}

static esp_err_t base64_encode_alloc(const uint8_t *input, size_t input_length, char **output)
{
    size_t encoded_length = 0;
    int result = mbedtls_base64_encode(NULL, 0, &encoded_length, input, input_length);
    if (result != MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL) {
        return ESP_FAIL;
    }

    char *buffer = calloc(1, encoded_length + 1);
    if (buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }

    result = mbedtls_base64_encode((unsigned char *) buffer, encoded_length + 1, &encoded_length, input, input_length);
    if (result != 0) {
        free(buffer);
        return ESP_FAIL;
    }

    buffer[encoded_length] = '\0';
    *output = buffer;
    return ESP_OK;
}

static esp_err_t base64_decode_alloc(const char *input, uint8_t **output, size_t *output_length)
{
    size_t decoded_length = 0;
    int result = mbedtls_base64_decode(NULL, 0, &decoded_length, (const unsigned char *) input, strlen(input));
    if (result != MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL) {
        return ESP_FAIL;
    }

    uint8_t *buffer = calloc(1, decoded_length);
    if (buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }

    result = mbedtls_base64_decode(buffer, decoded_length, &decoded_length, (const unsigned char *) input, strlen(input));
    if (result != 0) {
        free(buffer);
        return ESP_FAIL;
    }

    *output = buffer;
    *output_length = decoded_length;
    return ESP_OK;
}

static esp_err_t hex_encode_alloc(const uint8_t *input, size_t input_length, char **output)
{
    static const char hex_digits[] = "0123456789abcdef";
    char *buffer = calloc(1, HEX_STRING_SIZE(input_length));
    if (buffer == NULL) {
        return ESP_ERR_NO_MEM;
    }

    for (size_t index = 0; index < input_length; index++) {
        buffer[index * 2] = hex_digits[(input[index] >> 4) & 0x0f];
        buffer[index * 2 + 1] = hex_digits[input[index] & 0x0f];
    }

    buffer[input_length * 2] = '\0';
    *output = buffer;
    return ESP_OK;
}

static esp_err_t build_identity_labels(const identity_record_t *identity, char **fingerprint, char **key_id)
{
    uint8_t digest[SHA256_SIZE];
    char *fingerprint_hex = NULL;
    char *key_id_hex = NULL;
    char *key_id_buffer = NULL;

    mbedtls_sha256(identity->public_key, sizeof(identity->public_key), digest, 0);

    if (hex_encode_alloc(digest, sizeof(digest), &fingerprint_hex) != ESP_OK) {
        return ESP_FAIL;
    }

    if (hex_encode_alloc(digest, 16, &key_id_hex) != ESP_OK) {
        free(fingerprint_hex);
        return ESP_FAIL;
    }

    key_id_buffer = calloc(1, strlen("p256:") + strlen(key_id_hex) + 1);
    if (key_id_buffer == NULL) {
        free(fingerprint_hex);
        free(key_id_hex);
        return ESP_ERR_NO_MEM;
    }

    strcpy(key_id_buffer, "p256:");
    strcat(key_id_buffer, key_id_hex);

    free(key_id_hex);
    *fingerprint = fingerprint_hex;
    *key_id = key_id_buffer;
    return ESP_OK;
}

static esp_err_t load_identity(identity_record_t *identity)
{
    nvs_handle_t handle;
    size_t private_length = sizeof(identity->private_key);
    size_t public_length = sizeof(identity->public_key);

    memset(identity, 0, sizeof(*identity));

    esp_err_t err = nvs_open(IDENTITY_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_ERR_NOT_FOUND;
    }
    ESP_RETURN_ON_ERROR(err, TAG, "Failed to open NVS namespace");

    err = nvs_get_blob(handle, IDENTITY_PRIVATE_KEY, identity->private_key, &private_length);
    if (err == ESP_OK) {
        err = nvs_get_blob(handle, IDENTITY_PUBLIC_KEY, identity->public_key, &public_length);
    }
    nvs_close(handle);

    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_ERR_NOT_FOUND;
    }
    ESP_RETURN_ON_ERROR(err, TAG, "Failed to load identity from NVS");

    if (private_length != sizeof(identity->private_key) || public_length != sizeof(identity->public_key)) {
        return ESP_ERR_INVALID_SIZE;
    }

    identity->present = true;
    return ESP_OK;
}

static esp_err_t store_identity(const identity_record_t *identity)
{
    nvs_handle_t handle;

    esp_err_t err = nvs_open(IDENTITY_NAMESPACE, NVS_READWRITE, &handle);
    ESP_RETURN_ON_ERROR(err, TAG, "Failed to open identity namespace for write");

    err = nvs_set_blob(handle, IDENTITY_PRIVATE_KEY, identity->private_key, sizeof(identity->private_key));
    if (err == ESP_OK) {
        err = nvs_set_blob(handle, IDENTITY_PUBLIC_KEY, identity->public_key, sizeof(identity->public_key));
    }
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);

    ESP_RETURN_ON_ERROR(err, TAG, "Failed to store identity in NVS");
    return ESP_OK;
}

static esp_err_t generate_identity(identity_record_t *identity)
{
    esp_err_t err = ESP_OK;
    int result = 0;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;
    size_t public_length = 0;

    memset(identity, 0, sizeof(*identity));
    mbedtls_ecdsa_init(&ecdsa);

    err = init_rng(&entropy, &ctr_drbg);
    if (err != ESP_OK) {
        mbedtls_ecdsa_free(&ecdsa);
        return err;
    }

    result = mbedtls_ecdsa_genkey(
        &ecdsa,
        MBEDTLS_ECP_DP_SECP256R1,
        mbedtls_ctr_drbg_random,
        &ctr_drbg);
    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_ecdsa_genkey failed: -0x%04x", -result);
        err = ESP_FAIL;
        goto cleanup;
    }

    result = mbedtls_mpi_write_binary(&ecdsa.MBEDTLS_PRIVATE(d), identity->private_key, sizeof(identity->private_key));
    if (result != 0) {
        ESP_LOGE(TAG, "Failed to export private key: -0x%04x", -result);
        err = ESP_FAIL;
        goto cleanup;
    }

    result = mbedtls_ecp_point_write_binary(
        &ecdsa.MBEDTLS_PRIVATE(grp),
        &ecdsa.MBEDTLS_PRIVATE(Q),
        MBEDTLS_ECP_PF_UNCOMPRESSED,
        &public_length,
        identity->public_key,
        sizeof(identity->public_key));
    if (result != 0 || public_length != sizeof(identity->public_key)) {
        ESP_LOGE(TAG, "Failed to export public key: -0x%04x", -result);
        err = ESP_FAIL;
        goto cleanup;
    }

    identity->present = true;
    err = store_identity(identity);

cleanup:
    mbedtls_ecdsa_free(&ecdsa);
    free_rng(&entropy, &ctr_drbg);
    return err;
}

static esp_err_t ensure_identity(identity_record_t *identity, bool *created)
{
    esp_err_t err = load_identity(identity);
    if (err == ESP_OK) {
        *created = false;
        return ESP_OK;
    }

    if (err != ESP_ERR_NOT_FOUND) {
        return err;
    }

    err = generate_identity(identity);
    if (err == ESP_OK) {
        *created = true;
    }
    return err;
}

static void send_identity_response(int request_id, bool created, const identity_record_t *identity)
{
    cJSON *root = cJSON_CreateObject();
    char *public_key_base64 = NULL;
    char *fingerprint = NULL;
    char *key_id = NULL;
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    if (base64_encode_alloc(identity->public_key, sizeof(identity->public_key), &public_key_base64) != ESP_OK ||
        build_identity_labels(identity, &fingerprint, &key_id) != ESP_OK) {
        cJSON_Delete(root);
        free(public_key_base64);
        free(fingerprint);
        free(key_id);
        send_error_response(request_id, "internal_error", "Failed to encode public key");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddBoolToObject(root, "created", created);
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(root, "curve", "P-256");
    cJSON_AddStringToObject(root, "keyId", key_id);
    cJSON_AddStringToObject(root, "fingerprintHex", fingerprint);
    cJSON_AddStringToObject(root, "publicKeyBase64", public_key_base64);

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send identity response");
    }

    free(public_key_base64);
    free(fingerprint);
    free(key_id);
    cJSON_Delete(root);
}

static void send_gen_identity_response(int request_id)
{
    identity_record_t identity;
    bool created = false;

    esp_err_t err = ensure_identity(&identity, &created);
    if (err != ESP_OK) {
        send_error_response(request_id, "identity_error", "Failed to generate or load identity");
        return;
    }

    send_identity_response(request_id, created, &identity);
}

static void send_public_id_response(int request_id)
{
    identity_record_t identity;

    esp_err_t err = load_identity(&identity);
    if (err == ESP_ERR_NOT_FOUND) {
        send_error_response(request_id, "identity_missing", "Run GEN_IDENTITY first");
        return;
    }
    if (err != ESP_OK) {
        send_error_response(request_id, "identity_error", "Failed to load identity");
        return;
    }

    send_identity_response(request_id, false, &identity);
}

static void send_sign_response(int request_id, const identity_record_t *identity, const uint8_t *signature, size_t signature_length)
{
    cJSON *root = cJSON_CreateObject();
    char *signature_base64 = NULL;
    char *public_key_base64 = NULL;
    char *fingerprint = NULL;
    char *key_id = NULL;
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    if (base64_encode_alloc(signature, signature_length, &signature_base64) != ESP_OK ||
        base64_encode_alloc(identity->public_key, sizeof(identity->public_key), &public_key_base64) != ESP_OK ||
        build_identity_labels(identity, &fingerprint, &key_id) != ESP_OK) {
        free(signature_base64);
        free(public_key_base64);
        free(fingerprint);
        free(key_id);
        cJSON_Delete(root);
        send_error_response(request_id, "internal_error", "Failed to encode signature data");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(root, "curve", "P-256");
    cJSON_AddStringToObject(root, "keyId", key_id);
    cJSON_AddStringToObject(root, "fingerprintHex", fingerprint);
    cJSON_AddStringToObject(root, "signatureBase64", signature_base64);
    cJSON_AddStringToObject(root, "publicKeyBase64", public_key_base64);

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send sign response");
    }

    free(signature_base64);
    free(public_key_base64);
    free(fingerprint);
    free(key_id);
    cJSON_Delete(root);
}

static void send_sign_bytes_response(int request_id, cJSON *request)
{
    identity_record_t identity;
    cJSON *payload_item = cJSON_GetObjectItemCaseSensitive(request, "payloadBase64");
    uint8_t *payload = NULL;
    size_t payload_length = 0;
    uint8_t digest[SHA256_SIZE];
    uint8_t signature[SIGNATURE_BUFFER_SIZE];
    size_t signature_length = 0;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;

    if (!cJSON_IsString(payload_item) || payload_item->valuestring == NULL) {
        send_error_response(request_id, "missing_payload", "SIGN_BYTES requires payloadBase64");
        return;
    }

    esp_err_t err = load_identity(&identity);
    if (err == ESP_ERR_NOT_FOUND) {
        send_error_response(request_id, "identity_missing", "Run GEN_IDENTITY first");
        return;
    }
    if (err != ESP_OK) {
        send_error_response(request_id, "identity_error", "Failed to load identity");
        return;
    }

    err = base64_decode_alloc(payload_item->valuestring, &payload, &payload_length);
    if (err != ESP_OK) {
        send_error_response(request_id, "invalid_payload", "payloadBase64 is not valid base64");
        return;
    }

    mbedtls_ecdsa_init(&ecdsa);
    err = init_rng(&entropy, &ctr_drbg);
    if (err != ESP_OK) {
        free(payload);
        mbedtls_ecdsa_free(&ecdsa);
        send_error_response(request_id, "crypto_error", "Failed to initialize RNG");
        return;
    }

    int result = mbedtls_ecp_group_load(&ecdsa.MBEDTLS_PRIVATE(grp), MBEDTLS_ECP_DP_SECP256R1);
    if (result == 0) {
        result = mbedtls_mpi_read_binary(&ecdsa.MBEDTLS_PRIVATE(d), identity.private_key, sizeof(identity.private_key));
    }
    if (result == 0) {
        result = mbedtls_ecp_point_read_binary(
            &ecdsa.MBEDTLS_PRIVATE(grp),
            &ecdsa.MBEDTLS_PRIVATE(Q),
            identity.public_key,
            sizeof(identity.public_key));
    }
    if (result != 0) {
        ESP_LOGE(TAG, "Failed to load identity into ECDSA context: -0x%04x", -result);
        free(payload);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        send_error_response(request_id, "crypto_error", "Failed to prepare signing key");
        return;
    }

    mbedtls_sha256(payload, payload_length, digest, 0);
    free(payload);

    result = mbedtls_ecdsa_write_signature(
        &ecdsa,
        MBEDTLS_MD_SHA256,
        digest,
        sizeof(digest),
        signature,
        sizeof(signature),
        &signature_length,
        mbedtls_ctr_drbg_random,
        &ctr_drbg);
    mbedtls_ecdsa_free(&ecdsa);
    free_rng(&entropy, &ctr_drbg);

    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_ecdsa_write_signature failed: -0x%04x", -result);
        send_error_response(request_id, "crypto_error", "Failed to sign payload");
        return;
    }

    send_sign_response(request_id, &identity, signature, signature_length);
}

static void send_sign_hash_response(int request_id, cJSON *request)
{
    identity_record_t identity;
    cJSON *digest_item = cJSON_GetObjectItemCaseSensitive(request, "digestBase64");
    uint8_t *digest = NULL;
    size_t digest_length = 0;
    uint8_t signature[SIGNATURE_BUFFER_SIZE];
    size_t signature_length = 0;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;

    if (!cJSON_IsString(digest_item) || digest_item->valuestring == NULL) {
        send_error_response(request_id, "missing_digest", "SIGN_HASH requires digestBase64");
        return;
    }

    esp_err_t err = load_identity(&identity);
    if (err == ESP_ERR_NOT_FOUND) {
        send_error_response(request_id, "identity_missing", "Run GEN_IDENTITY first");
        return;
    }
    if (err != ESP_OK) {
        send_error_response(request_id, "identity_error", "Failed to load identity");
        return;
    }

    err = base64_decode_alloc(digest_item->valuestring, &digest, &digest_length);
    if (err != ESP_OK || digest_length != SHA256_SIZE) {
        free(digest);
        send_error_response(request_id, "invalid_digest", "digestBase64 must decode to 32 bytes");
        return;
    }

    mbedtls_ecdsa_init(&ecdsa);
    err = init_rng(&entropy, &ctr_drbg);
    if (err != ESP_OK) {
        free(digest);
        mbedtls_ecdsa_free(&ecdsa);
        send_error_response(request_id, "crypto_error", "Failed to initialize RNG");
        return;
    }

    int result = mbedtls_ecp_group_load(&ecdsa.MBEDTLS_PRIVATE(grp), MBEDTLS_ECP_DP_SECP256R1);
    if (result == 0) {
        result = mbedtls_mpi_read_binary(&ecdsa.MBEDTLS_PRIVATE(d), identity.private_key, sizeof(identity.private_key));
    }
    if (result == 0) {
        result = mbedtls_ecp_point_read_binary(
            &ecdsa.MBEDTLS_PRIVATE(grp),
            &ecdsa.MBEDTLS_PRIVATE(Q),
            identity.public_key,
            sizeof(identity.public_key));
    }
    if (result != 0) {
        ESP_LOGE(TAG, "Failed to load identity into ECDSA context: -0x%04x", -result);
        free(digest);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        send_error_response(request_id, "crypto_error", "Failed to prepare signing key");
        return;
    }

    result = mbedtls_ecdsa_write_signature(
        &ecdsa,
        MBEDTLS_MD_SHA256,
        digest,
        digest_length,
        signature,
        sizeof(signature),
        &signature_length,
        mbedtls_ctr_drbg_random,
        &ctr_drbg);
    free(digest);
    mbedtls_ecdsa_free(&ecdsa);
    free_rng(&entropy, &ctr_drbg);

    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_ecdsa_write_signature failed: -0x%04x", -result);
        send_error_response(request_id, "crypto_error", "Failed to sign digest");
        return;
    }

    send_sign_response(request_id, &identity, signature, signature_length);
}

static void handle_command_line(const char *line)
{
    cJSON *request = cJSON_Parse(line);
    if (request == NULL) {
        send_error_response(0, "invalid_json", "Could not parse request");
        return;
    }

    int request_id = 0;
    cJSON *id_item = cJSON_GetObjectItemCaseSensitive(request, "id");
    if (cJSON_IsNumber(id_item)) {
        request_id = id_item->valueint;
    }

    cJSON *cmd_item = cJSON_GetObjectItemCaseSensitive(request, "cmd");
    if (!cJSON_IsString(cmd_item) || cmd_item->valuestring == NULL) {
        cJSON_Delete(request);
        send_error_response(request_id, "missing_command", "Request must include a string cmd");
        return;
    }

    if (strcmp(cmd_item->valuestring, CMD_PING) == 0) {
        send_ping_response(request_id);
    } else if (strcmp(cmd_item->valuestring, CMD_GET_INFO) == 0) {
        send_info_response(request_id);
    } else if (strcmp(cmd_item->valuestring, CMD_GEN_IDENTITY) == 0) {
        send_gen_identity_response(request_id);
    } else if (strcmp(cmd_item->valuestring, CMD_GET_PUBLIC_ID) == 0) {
        send_public_id_response(request_id);
    } else if (strcmp(cmd_item->valuestring, CMD_SIGN_BYTES) == 0) {
        send_sign_bytes_response(request_id, request);
    } else if (strcmp(cmd_item->valuestring, CMD_SIGN_HASH) == 0) {
        send_sign_hash_response(request_id, request);
    } else {
        send_error_response(request_id, "unknown_command", cmd_item->valuestring);
    }

    cJSON_Delete(request);
}

static void init_console_transport(void)
{
    const uart_config_t config = {
        .baud_rate = CONSOLE_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(CONSOLE_UART, 2048, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(CONSOLE_UART, &config));
    ESP_ERROR_CHECK(uart_set_pin(CONSOLE_UART, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    ESP_ERROR_CHECK(uart_flush(CONSOLE_UART));
}

static void init_storage(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
}

void app_main(void)
{
    init_storage();
    init_console_transport();

    ESP_LOGI(TAG, "ESP host identity starting");

    size_t line_length = 0;
    while (true) {
        int bytes_read = uart_read_bytes(CONSOLE_UART, s_rx_buffer, sizeof(s_rx_buffer), pdMS_TO_TICKS(20));
        if (bytes_read <= 0) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        for (int index = 0; index < bytes_read; index++) {
            char current = s_rx_buffer[index];
            if (current == '\r') {
                continue;
            }

            if (current == '\n') {
                s_line_buffer[line_length] = '\0';
                trim_line(s_line_buffer);
                if (s_line_buffer[0] != '\0') {
                    handle_command_line(s_line_buffer);
                }
                line_length = 0;
                continue;
            }

            if (line_length + 1 >= sizeof(s_line_buffer)) {
                send_error_response(0, "request_too_large", "Input line exceeded buffer");
                line_length = 0;
                continue;
            }

            s_line_buffer[line_length++] = current;
        }
    }
}
