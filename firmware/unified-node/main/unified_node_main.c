#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
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
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
#include "driver/usb_serial_jtag.h"
#elif defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
#include "driver/i2c.h"
#include "driver/uart.h"
#else
#error "Unsupported unified node board profile"
#endif

#define APP_VERSION "0.2.0"
#define INPUT_BUFFER_SIZE 2048
#define IDENTITY_NAMESPACE "identity"
#define IDENTITY_PRIVATE_KEY "p256_priv"
#define IDENTITY_PUBLIC_KEY "p256_pub"
#define HARDWARE_NAMESPACE "hardware"
#define HARDWARE_DISPLAY_PRESET_KEY "display_preset"
#define P256_PRIVATE_KEY_SIZE 32
#define P256_PUBLIC_KEY_SIZE 65
#define SHA256_SIZE 32
#define SIGNATURE_BUFFER_SIZE 80
#define HEX_STRING_SIZE(bytes) ((bytes) * 2 + 1)
#define OLED_FRAMEBUFFER_SIZE 1024
#define TEST_OUTPUT_STATUS_RESTORE_DELAY_MS 1200
#define HOST_OLED_WIDTH 128
#define HOST_OLED_HEIGHT 64
#define HOST_OLED_PAGE_COUNT 8
#define HOST_OLED_COLUMN_OFFSET 2

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
#define TDONGLE_DISPLAY_HOST SPI2_HOST
#define TDONGLE_PIN_LCD_CS GPIO_NUM_4
#define TDONGLE_PIN_LCD_MOSI GPIO_NUM_3
#define TDONGLE_PIN_LCD_CLK GPIO_NUM_5
#define TDONGLE_PIN_LCD_DC GPIO_NUM_2
#define TDONGLE_PIN_LCD_RST GPIO_NUM_1
#define TDONGLE_PIN_LCD_BL GPIO_NUM_38
#define TDONGLE_PIN_APA102_CLK GPIO_NUM_39
#define TDONGLE_PIN_APA102_DATA GPIO_NUM_40
#define TDONGLE_LCD_WIDTH 80
#define TDONGLE_LCD_HEIGHT 160
#define TDONGLE_LCD_X_OFFSET 26
#define TDONGLE_LCD_Y_OFFSET 1
#define TDONGLE_BACKLIGHT_LEDC_MODE LEDC_LOW_SPEED_MODE
#define TDONGLE_BACKLIGHT_LEDC_TIMER LEDC_TIMER_0
#define TDONGLE_BACKLIGHT_LEDC_CHANNEL LEDC_CHANNEL_0
#define TDONGLE_BACKLIGHT_LEDC_FREQUENCY_HZ 5000
#define TDONGLE_BACKLIGHT_LEDC_RESOLUTION LEDC_TIMER_13_BIT
#define TDONGLE_BACKLIGHT_LEDC_MAX_DUTY ((1 << 13) - 1)
#endif

#if defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
#define CONSOLE_UART UART_NUM_0
#define CONSOLE_BAUD_RATE 115200
#define OLED_SCAN_TIMEOUT_MS 60
#define HOST_DISPLAY_SPI_HOST SPI2_HOST
#define HOST_SPI_PROBE_CLOCK_HZ (1000 * 1000)
#define HOST_ILI9341_WIDTH 240
#define HOST_ILI9341_HEIGHT 320
#define HOST_ILI9341_TEXT_SCALE 2
#endif

typedef struct {
    const char *log_tag;
    const char *device;
    const char *chip;
    const char *profile;
    const char *transport;
    const char *personalization;
    int gpio_pin_count;
    const char *gpio_input_range;
    const char *gpio_output_range;
} board_config_t;

typedef struct {
    bool present;
    uint8_t private_key[P256_PRIVATE_KEY_SIZE];
    uint8_t public_key[P256_PUBLIC_KEY_SIZE];
} identity_record_t;

typedef struct {
    const char *kind;
    const char *status;
    const char *detail;
} output_test_result_t;

typedef struct {
    char title[21];
    char board[21];
    char status[21];
    char transport[21];
    char key[21];
    char output[21];
} status_screen_t;

static char s_line_buffer[INPUT_BUFFER_SIZE];
static char s_rx_buffer[64];

#define STATUS_SCREEN_MAX_LINE 20
#define FONT5X7_WIDTH 5
#define FONT5X7_HEIGHT 7
#define FONT5X7_SPACING 1

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
static const board_config_t BOARD = {
    .log_tag = "unified_tdongle_s3",
    .device = "lilygo-t-dongle-s3",
    .chip = "esp32s3",
    .profile = "identity-token",
    .transport = "usb-serial-jtag",
    .personalization = "esp-messenger-unified-tdongle-s3",
    .gpio_pin_count = 49,
    .gpio_input_range = "0-48",
    .gpio_output_range = "0-48"
};
#elif defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
static const board_config_t BOARD = {
    .log_tag = "unified_host_esp32",
    .device = "esp32-host-identity",
    .chip = "esp32",
    .profile = "host-attached-node",
    .transport = "uart0",
    .personalization = "esp-messenger-unified-host-esp32",
    .gpio_pin_count = 40,
    .gpio_input_range = "0-39",
    .gpio_output_range = "0-33"
};
#endif

static const char *TAG = NULL;

static esp_err_t write_bytes_all(const char *data, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
        int written = usb_serial_jtag_write_bytes(data + offset, length - offset, pdMS_TO_TICKS(5000));
#else
        int written = uart_write_bytes(CONSOLE_UART, data + offset, length - offset);
#endif
        if (written <= 0) {
            return ESP_FAIL;
        }
        offset += (size_t) written;
    }

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
    return usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(5000));
#else
    return uart_wait_tx_done(CONSOLE_UART, pdMS_TO_TICKS(5000));
#endif
}

static esp_err_t send_json(cJSON *root)
{
    char *rendered = cJSON_PrintUnformatted(root);
    if (rendered == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t result = write_bytes_all(rendered, strlen(rendered));
    if (result == ESP_OK) {
        result = write_bytes_all("\n", 1);
    }

    cJSON_free(rendered);
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
    cJSON_AddStringToObject(root, "detail", detail);
    send_json(root);
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
    send_json(root);
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
    cJSON_AddStringToObject(root, "device", BOARD.device);
    cJSON_AddStringToObject(root, "chip", BOARD.chip);
    cJSON_AddStringToObject(root, "role", role_to_string(NODE_ROLE_IDENTITY));
    cJSON_AddStringToObject(root, "profile", BOARD.profile);
    cJSON_AddStringToObject(root, "version", APP_VERSION);
    cJSON_AddStringToObject(root, "transport", BOARD.transport);
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(
        root,
        "capabilities",
        "PING,GET_INFO,GET_PLATFORM_IO,TEST_OUTPUT,GEN_IDENTITY,GET_PUBLIC_ID,SIGN_BYTES,SIGN_HASH");

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send info response");
    }
    cJSON_Delete(root);
}

#if defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
typedef struct {
    bool detected;
    int sda;
    int scl;
    int address;
} oled_probe_result_t;

typedef struct {
    bool detected;
    int mosi;
    int miso;
    int sclk;
    int cs;
    int dc;
    int rst;
    int bl;
    uint8_t signature[4];
} tft_probe_result_t;

typedef struct {
    bool detected;
    int candidate_index;
    tft_probe_result_t tft;
} blind_tft_result_t;

static oled_probe_result_t s_cached_oled = {
    .detected = false,
    .sda = -1,
    .scl = -1,
    .address = -1
};

static tft_probe_result_t s_cached_tft = {
    .detected = false,
    .mosi = -1,
    .miso = -1,
    .sclk = -1,
    .cs = -1,
    .dc = -1,
    .rst = -1,
    .bl = -1,
    .signature = {0x00, 0x00, 0x00, 0x00}
};

static blind_tft_result_t s_cached_blind_tft = {
    .detected = false,
    .candidate_index = -1,
    .tft = {
        .detected = false,
        .mosi = -1,
        .miso = -1,
        .sclk = -1,
        .cs = -1,
        .dc = -1,
        .rst = -1,
        .bl = -1,
        .signature = {0x00, 0x00, 0x00, 0x00}
    }
};
static bool s_cached_blind_tft_persisted = false;

typedef struct {
    int mosi;
    int miso;
    int sclk;
    int cs;
    int dc;
    int rst;
    int bl;
    const char *label;
} tft_candidate_t;

static const tft_candidate_t HOST_ILI9341_CANDIDATES[] = {
    {23, 19, 18, 5, 21, 4, -1, "user-cs5-dc21-rst4-miso19-led3v3"},
    {23, -1, 18, 5, 21, 4, -1, "user-cs5-dc21-rst4-led3v3"},
    {23, 19, 18, 15, 2, 4, 32, "vspi-cs15-dc2-rst4-bl32"},
    {23, 19, 18, 5, 2, 4, 32, "vspi-cs5-dc2-rst4-bl32"},
    {23, 19, 18, 15, 27, 33, 32, "vspi-cs15-dc27-rst33-bl32"},
    {23, 19, 18, 5, 27, 33, 32, "vspi-cs5-dc27-rst33-bl32"},
    {13, 12, 14, 15, 2, 4, 32, "hspi-cs15-dc2-rst4-bl32"},
    {13, 12, 14, 15, 27, 33, 32, "hspi-cs15-dc27-rst33-bl32"},
    {23, -1, 18, 5, 21, 4, 32, "user-cs5-dc21-rst4-bl32"},
    {23, 19, 18, 15, 2, -1, -1, "vspi-cs15-dc2-noreset"},
    {23, 19, 18, 5, 27, -1, -1, "vspi-cs5-dc27-noreset"}
};

static blind_tft_result_t blind_tft_result_from_preset_index(int preset_index)
{
    blind_tft_result_t result = {
        .detected = false,
        .candidate_index = -1,
        .tft = {
            .detected = false,
            .mosi = -1,
            .miso = -1,
            .sclk = -1,
            .cs = -1,
            .dc = -1,
            .rst = -1,
            .bl = -1,
            .signature = {0x00, 0x00, 0x00, 0x00}
        }
    };

    if (preset_index < 0 || (size_t) preset_index >= (sizeof(HOST_ILI9341_CANDIDATES) / sizeof(HOST_ILI9341_CANDIDATES[0]))) {
        return result;
    }

    const tft_candidate_t *candidate = &HOST_ILI9341_CANDIDATES[preset_index];
    result.detected = true;
    result.candidate_index = preset_index;
    result.tft.detected = true;
    result.tft.mosi = candidate->mosi;
    result.tft.miso = candidate->miso;
    result.tft.sclk = candidate->sclk;
    result.tft.cs = candidate->cs;
    result.tft.dc = candidate->dc;
    result.tft.rst = candidate->rst;
    result.tft.bl = candidate->bl;
    memset(result.tft.signature, 0, sizeof(result.tft.signature));
    return result;
}

static esp_err_t load_learned_host_display_preset(int *preset_index)
{
    nvs_handle_t nvs = 0;
    esp_err_t result = nvs_open(HARDWARE_NAMESPACE, NVS_READONLY, &nvs);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_ERR_NOT_FOUND;
    }
    ESP_RETURN_ON_ERROR(result, TAG, "Failed to open hardware namespace");

    int32_t stored_index = -1;
    result = nvs_get_i32(nvs, HARDWARE_DISPLAY_PRESET_KEY, &stored_index);
    nvs_close(nvs);
    if (result != ESP_OK) {
        return result;
    }

    *preset_index = (int) stored_index;
    return ESP_OK;
}

static esp_err_t save_learned_host_display_preset(int preset_index)
{
    nvs_handle_t nvs = 0;
    esp_err_t result = nvs_open(HARDWARE_NAMESPACE, NVS_READWRITE, &nvs);
    ESP_RETURN_ON_ERROR(result, TAG, "Failed to open hardware namespace");

    result = nvs_set_i32(nvs, HARDWARE_DISPLAY_PRESET_KEY, (int32_t) preset_index);
    if (result == ESP_OK) {
        result = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return result;
}

static esp_err_t clear_learned_host_display_preset(void)
{
    nvs_handle_t nvs = 0;
    esp_err_t result = nvs_open(HARDWARE_NAMESPACE, NVS_READWRITE, &nvs);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(result, TAG, "Failed to open hardware namespace");

    result = nvs_erase_key(nvs, HARDWARE_DISPLAY_PRESET_KEY);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        result = ESP_OK;
    }
    if (result == ESP_OK) {
        result = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return result;
}

static esp_err_t probe_i2c_address(i2c_port_t port, uint8_t address)
{
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    if (cmd == NULL) {
        return ESP_ERR_NO_MEM;
    }

    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (address << 1) | I2C_MASTER_WRITE, true);
    i2c_master_stop(cmd);
    esp_err_t result = i2c_master_cmd_begin(port, cmd, pdMS_TO_TICKS(OLED_SCAN_TIMEOUT_MS));
    i2c_cmd_link_delete(cmd);
    return result;
}

static oled_probe_result_t probe_common_oled_outputs(void)
{
    static const struct {
        int sda;
        int scl;
    } candidates[] = {
        {21, 22},
        {4, 15},
        {5, 4},
        {18, 23}
    };
    static const uint8_t addresses[] = {0x3C, 0x3D};

    oled_probe_result_t result = {
        .detected = false,
        .sda = -1,
        .scl = -1,
        .address = -1
    };

    for (size_t pair_index = 0; pair_index < sizeof(candidates) / sizeof(candidates[0]); pair_index++) {
        i2c_config_t config = {
            .mode = I2C_MODE_MASTER,
            .sda_io_num = candidates[pair_index].sda,
            .scl_io_num = candidates[pair_index].scl,
            .sda_pullup_en = GPIO_PULLUP_ENABLE,
            .scl_pullup_en = GPIO_PULLUP_ENABLE,
            .master.clk_speed = 100000
        };

        if (i2c_param_config(I2C_NUM_0, &config) != ESP_OK) {
            continue;
        }
        esp_err_t install_result = i2c_driver_install(I2C_NUM_0, config.mode, 0, 0, 0);
        if (install_result == ESP_ERR_INVALID_STATE) {
            i2c_driver_delete(I2C_NUM_0);
            install_result = i2c_driver_install(I2C_NUM_0, config.mode, 0, 0, 0);
        }
        if (install_result != ESP_OK) {
            continue;
        }

        for (size_t address_index = 0; address_index < sizeof(addresses) / sizeof(addresses[0]); address_index++) {
            if (probe_i2c_address(I2C_NUM_0, addresses[address_index]) == ESP_OK) {
                result.detected = true;
                result.sda = candidates[pair_index].sda;
                result.scl = candidates[pair_index].scl;
                result.address = addresses[address_index];
                break;
            }
        }

        i2c_driver_delete(I2C_NUM_0);
        if (result.detected) {
            break;
        }
    }

    return result;
}

static oled_probe_result_t get_known_oled_output(void)
{
    if (s_cached_oled.detected) {
        return s_cached_oled;
    }

    oled_probe_result_t probed = probe_common_oled_outputs();
    if (probed.detected) {
        s_cached_oled = probed;
    }
    return probed;
}

static esp_err_t host_spi_panel_open(const tft_candidate_t *candidate, spi_device_handle_t *handle, int clock_hz)
{
    const gpio_num_t shared_touch_cs_pin = GPIO_NUM_15;

    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(shared_touch_cs_pin));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(shared_touch_cs_pin, GPIO_MODE_OUTPUT));
    gpio_set_level(shared_touch_cs_pin, 1);

    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin((gpio_num_t) candidate->dc));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction((gpio_num_t) candidate->dc, GPIO_MODE_OUTPUT));

    if (candidate->rst >= 0) {
        ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin((gpio_num_t) candidate->rst));
        ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction((gpio_num_t) candidate->rst, GPIO_MODE_OUTPUT));
        gpio_set_level((gpio_num_t) candidate->rst, 1);
    }

    if (candidate->bl >= 0) {
        ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin((gpio_num_t) candidate->bl));
        ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction((gpio_num_t) candidate->bl, GPIO_MODE_OUTPUT));
        gpio_set_level((gpio_num_t) candidate->bl, 1);
    }

    spi_bus_config_t bus_config = {
        .mosi_io_num = candidate->mosi,
        .miso_io_num = candidate->miso,
        .sclk_io_num = candidate->sclk,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 512
    };
    spi_device_interface_config_t device_config = {
        .clock_speed_hz = clock_hz,
        .mode = 0,
        .spics_io_num = candidate->cs,
        .queue_size = 1
    };

    esp_err_t result = spi_bus_initialize(HOST_DISPLAY_SPI_HOST, &bus_config, SPI_DMA_CH_AUTO);
    if (result == ESP_ERR_INVALID_STATE) {
        spi_bus_free(HOST_DISPLAY_SPI_HOST);
        result = spi_bus_initialize(HOST_DISPLAY_SPI_HOST, &bus_config, SPI_DMA_CH_AUTO);
    }
    if (result != ESP_OK) {
        return result;
    }

    result = spi_bus_add_device(HOST_DISPLAY_SPI_HOST, &device_config, handle);
    if (result != ESP_OK) {
        spi_bus_free(HOST_DISPLAY_SPI_HOST);
        return result;
    }

    if (candidate->rst >= 0) {
        gpio_set_level((gpio_num_t) candidate->rst, 0);
        vTaskDelay(pdMS_TO_TICKS(20));
        gpio_set_level((gpio_num_t) candidate->rst, 1);
        vTaskDelay(pdMS_TO_TICKS(120));
    }

    return ESP_OK;
}

static void host_spi_panel_close(spi_device_handle_t handle)
{
    if (handle != NULL) {
        spi_bus_remove_device(handle);
    }
    spi_bus_free(HOST_DISPLAY_SPI_HOST);
}

static esp_err_t host_spi_panel_send_command(const tft_candidate_t *candidate, spi_device_handle_t handle, uint8_t command)
{
    gpio_set_level((gpio_num_t) candidate->dc, 0);
    spi_transaction_t transaction = {0};
    transaction.length = 8;
    transaction.tx_buffer = &command;
    return spi_device_polling_transmit(handle, &transaction);
}

static esp_err_t host_spi_panel_send_data(const tft_candidate_t *candidate, spi_device_handle_t handle, const uint8_t *data, size_t length)
{
    if (length == 0) {
        return ESP_OK;
    }

    gpio_set_level((gpio_num_t) candidate->dc, 1);
    spi_transaction_t transaction = {0};
    transaction.length = length * 8;
    transaction.tx_buffer = data;
    return spi_device_polling_transmit(handle, &transaction);
}

static esp_err_t host_spi_panel_read_data(const tft_candidate_t *candidate, spi_device_handle_t handle, uint8_t *data, size_t length)
{
    if (length == 0) {
        return ESP_OK;
    }

    uint8_t dummy_tx[8] = {0};
    if (length > sizeof(dummy_tx)) {
        return ESP_ERR_INVALID_ARG;
    }

    gpio_set_level((gpio_num_t) candidate->dc, 1);
    spi_transaction_t transaction = {0};
    transaction.length = length * 8;
    transaction.rxlength = length * 8;
    transaction.tx_buffer = dummy_tx;
    transaction.rx_buffer = data;
    return spi_device_polling_transmit(handle, &transaction);
}

static bool ili9341_signature_matches(const uint8_t *data, size_t length)
{
    if (data == NULL || length < 2) {
        return false;
    }

    for (size_t index = 0; index + 1 < length; index++) {
        if (data[index] == 0x93 && data[index + 1] == 0x41) {
            return true;
        }
    }
    return false;
}

static esp_err_t host_ili9341_read_signature(const tft_candidate_t *candidate, uint8_t *signature_out)
{
    spi_device_handle_t handle = NULL;
    esp_err_t result = host_spi_panel_open(candidate, &handle, HOST_SPI_PROBE_CLOCK_HZ);
    if (result != ESP_OK) {
        return result;
    }

    uint8_t read_id4[4] = {0};
    result = host_spi_panel_send_command(candidate, handle, 0xD3);
    if (result == ESP_OK) {
        result = host_spi_panel_read_data(candidate, handle, read_id4, sizeof(read_id4));
    }

    if (result == ESP_OK && !ili9341_signature_matches(read_id4, sizeof(read_id4))) {
        uint8_t read_display_id[4] = {0};
        result = host_spi_panel_send_command(candidate, handle, 0x04);
        if (result == ESP_OK) {
            result = host_spi_panel_read_data(candidate, handle, read_display_id, sizeof(read_display_id));
        }
        if (result == ESP_OK && ili9341_signature_matches(read_display_id, sizeof(read_display_id))) {
            memcpy(read_id4, read_display_id, sizeof(read_id4));
        }
    }

    if (result == ESP_OK) {
        memcpy(signature_out, read_id4, 4);
        if (!ili9341_signature_matches(signature_out, 4)) {
            result = ESP_ERR_NOT_FOUND;
        }
    }

    host_spi_panel_close(handle);
    return result;
}

static tft_probe_result_t probe_common_ili9341_outputs(void)
{
    tft_probe_result_t result = {
        .detected = false,
        .mosi = -1,
        .miso = -1,
        .sclk = -1,
        .cs = -1,
        .dc = -1,
        .rst = -1,
        .bl = -1,
        .signature = {0x00, 0x00, 0x00, 0x00}
    };

    for (size_t index = 0; index < sizeof(HOST_ILI9341_CANDIDATES) / sizeof(HOST_ILI9341_CANDIDATES[0]); index++) {
        uint8_t signature[4] = {0};
        if (host_ili9341_read_signature(&HOST_ILI9341_CANDIDATES[index], signature) == ESP_OK) {
            result.detected = true;
            result.mosi = HOST_ILI9341_CANDIDATES[index].mosi;
            result.miso = HOST_ILI9341_CANDIDATES[index].miso;
            result.sclk = HOST_ILI9341_CANDIDATES[index].sclk;
            result.cs = HOST_ILI9341_CANDIDATES[index].cs;
            result.dc = HOST_ILI9341_CANDIDATES[index].dc;
            result.rst = HOST_ILI9341_CANDIDATES[index].rst;
            result.bl = HOST_ILI9341_CANDIDATES[index].bl;
            memcpy(result.signature, signature, sizeof(result.signature));
            ESP_LOGI(TAG, "ILI9341 detected using preset %s", HOST_ILI9341_CANDIDATES[index].label);
            break;
        }
    }

    return result;
}

static tft_probe_result_t get_known_ili9341_output(void)
{
    if (s_cached_tft.detected) {
        return s_cached_tft;
    }
    if (s_cached_blind_tft.detected) {
        return s_cached_blind_tft.tft;
    }

    int learned_preset_index = -1;
    if (load_learned_host_display_preset(&learned_preset_index) == ESP_OK) {
        blind_tft_result_t learned = blind_tft_result_from_preset_index(learned_preset_index);
        if (learned.detected) {
            s_cached_blind_tft = learned;
            s_cached_blind_tft_persisted = true;
            return learned.tft;
        }
    }

    tft_probe_result_t probed = probe_common_ili9341_outputs();
    if (probed.detected) {
        s_cached_tft = probed;
    }
    return probed;
}

static const uint8_t *font5x7_pattern(char c);

static void mono_framebuffer_clear(uint8_t *framebuffer, size_t length)
{
    memset(framebuffer, 0, length);
}

static void mono_framebuffer_set_pixel(uint8_t *framebuffer, size_t width, size_t height, int x, int y, bool on)
{
    if (!on || x < 0 || y < 0 || (size_t) x >= width || (size_t) y >= height) {
        return;
    }

    size_t index = (size_t) x + ((size_t) y / 8) * width;
    framebuffer[index] |= (uint8_t) (1u << (y % 8));
}

static void mono_framebuffer_draw_char(uint8_t *framebuffer, size_t width, size_t height, int x, int y, char c)
{
    const uint8_t *pattern = font5x7_pattern(c);
    for (int column = 0; column < FONT5X7_WIDTH; column++) {
        for (int row = 0; row < FONT5X7_HEIGHT; row++) {
            mono_framebuffer_set_pixel(framebuffer, width, height, x + column, y + row, ((pattern[column] >> row) & 0x01) != 0);
        }
    }
}

static void mono_framebuffer_draw_text(uint8_t *framebuffer, size_t width, size_t height, int x, int y, const char *text)
{
    int cursor_x = x;
    while (text != NULL && *text != '\0') {
        mono_framebuffer_draw_char(framebuffer, width, height, cursor_x, y, *text);
        cursor_x += FONT5X7_WIDTH + FONT5X7_SPACING;
        text++;
    }
}

static void mono_framebuffer_draw_hline(uint8_t *framebuffer, size_t width, size_t height, int x, int y, int line_width)
{
    for (int offset = 0; offset < line_width; offset++) {
        mono_framebuffer_set_pixel(framebuffer, width, height, x + offset, y, true);
    }
}

static void mono_framebuffer_draw_rect(uint8_t *framebuffer, size_t width, size_t height, int x, int y, int rect_width, int rect_height)
{
    if (rect_width <= 0 || rect_height <= 0) {
        return;
    }

    mono_framebuffer_draw_hline(framebuffer, width, height, x, y, rect_width);
    mono_framebuffer_draw_hline(framebuffer, width, height, x, y + rect_height - 1, rect_width);
    for (int row = 0; row < rect_height; row++) {
        mono_framebuffer_set_pixel(framebuffer, width, height, x, y + row, true);
        mono_framebuffer_set_pixel(framebuffer, width, height, x + rect_width - 1, y + row, true);
    }
}
#endif

static void append_test_result(cJSON *results, const char *kind, const char *status, const char *detail)
{
    cJSON *entry = cJSON_CreateObject();
    if (entry == NULL) {
        return;
    }

    cJSON_AddStringToObject(entry, "kind", kind);
    cJSON_AddStringToObject(entry, "status", status);
    if (detail != NULL) {
        cJSON_AddStringToObject(entry, "detail", detail);
    }
    cJSON_AddItemToArray(results, entry);
}

static esp_err_t load_identity(identity_record_t *identity);
static esp_err_t build_identity_labels(const identity_record_t *identity, char **fingerprint, char **key_id);
static const uint8_t *font5x7_pattern(char c);

static char normalize_font_char(char c)
{
    if (c >= 'a' && c <= 'z') {
        return (char) (c - 32);
    }

    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
        return c;
    }

    switch (c) {
    case ' ':
    case '-':
    case '.':
    case ':':
        return c;
    default:
        return ' ';
    }
}

static const uint8_t *font5x7_pattern(char c)
{
    static const uint8_t glyph_space[5] = {0x00, 0x00, 0x00, 0x00, 0x00};
    static const uint8_t glyph_dash[5] = {0x08, 0x08, 0x08, 0x08, 0x08};
    static const uint8_t glyph_dot[5] = {0x00, 0x60, 0x60, 0x00, 0x00};
    static const uint8_t glyph_colon[5] = {0x00, 0x36, 0x36, 0x00, 0x00};
    static const uint8_t glyph_0[5] = {0x3E, 0x51, 0x49, 0x45, 0x3E};
    static const uint8_t glyph_1[5] = {0x00, 0x42, 0x7F, 0x40, 0x00};
    static const uint8_t glyph_2[5] = {0x42, 0x61, 0x51, 0x49, 0x46};
    static const uint8_t glyph_3[5] = {0x21, 0x41, 0x45, 0x4B, 0x31};
    static const uint8_t glyph_4[5] = {0x18, 0x14, 0x12, 0x7F, 0x10};
    static const uint8_t glyph_5[5] = {0x27, 0x45, 0x45, 0x45, 0x39};
    static const uint8_t glyph_6[5] = {0x3C, 0x4A, 0x49, 0x49, 0x30};
    static const uint8_t glyph_7[5] = {0x01, 0x71, 0x09, 0x05, 0x03};
    static const uint8_t glyph_8[5] = {0x36, 0x49, 0x49, 0x49, 0x36};
    static const uint8_t glyph_9[5] = {0x06, 0x49, 0x49, 0x29, 0x1E};
    static const uint8_t glyph_A[5] = {0x7E, 0x11, 0x11, 0x11, 0x7E};
    static const uint8_t glyph_B[5] = {0x7F, 0x49, 0x49, 0x49, 0x36};
    static const uint8_t glyph_C[5] = {0x3E, 0x41, 0x41, 0x41, 0x22};
    static const uint8_t glyph_D[5] = {0x7F, 0x41, 0x41, 0x22, 0x1C};
    static const uint8_t glyph_E[5] = {0x7F, 0x49, 0x49, 0x49, 0x41};
    static const uint8_t glyph_F[5] = {0x7F, 0x09, 0x09, 0x09, 0x01};
    static const uint8_t glyph_G[5] = {0x3E, 0x41, 0x49, 0x49, 0x7A};
    static const uint8_t glyph_H[5] = {0x7F, 0x08, 0x08, 0x08, 0x7F};
    static const uint8_t glyph_I[5] = {0x00, 0x41, 0x7F, 0x41, 0x00};
    static const uint8_t glyph_J[5] = {0x20, 0x40, 0x41, 0x3F, 0x01};
    static const uint8_t glyph_K[5] = {0x7F, 0x08, 0x14, 0x22, 0x41};
    static const uint8_t glyph_L[5] = {0x7F, 0x40, 0x40, 0x40, 0x40};
    static const uint8_t glyph_M[5] = {0x7F, 0x02, 0x0C, 0x02, 0x7F};
    static const uint8_t glyph_N[5] = {0x7F, 0x04, 0x08, 0x10, 0x7F};
    static const uint8_t glyph_O[5] = {0x3E, 0x41, 0x41, 0x41, 0x3E};
    static const uint8_t glyph_P[5] = {0x7F, 0x09, 0x09, 0x09, 0x06};
    static const uint8_t glyph_Q[5] = {0x3E, 0x41, 0x51, 0x21, 0x5E};
    static const uint8_t glyph_R[5] = {0x7F, 0x09, 0x19, 0x29, 0x46};
    static const uint8_t glyph_S[5] = {0x46, 0x49, 0x49, 0x49, 0x31};
    static const uint8_t glyph_T[5] = {0x01, 0x01, 0x7F, 0x01, 0x01};
    static const uint8_t glyph_U[5] = {0x3F, 0x40, 0x40, 0x40, 0x3F};
    static const uint8_t glyph_V[5] = {0x1F, 0x20, 0x40, 0x20, 0x1F};
    static const uint8_t glyph_W[5] = {0x7F, 0x20, 0x18, 0x20, 0x7F};
    static const uint8_t glyph_X[5] = {0x63, 0x14, 0x08, 0x14, 0x63};
    static const uint8_t glyph_Y[5] = {0x03, 0x04, 0x78, 0x04, 0x03};
    static const uint8_t glyph_Z[5] = {0x61, 0x51, 0x49, 0x45, 0x43};

    c = normalize_font_char(c);
    switch (c) {
    case '-': return glyph_dash;
    case '.': return glyph_dot;
    case ':': return glyph_colon;
    case '0': return glyph_0;
    case '1': return glyph_1;
    case '2': return glyph_2;
    case '3': return glyph_3;
    case '4': return glyph_4;
    case '5': return glyph_5;
    case '6': return glyph_6;
    case '7': return glyph_7;
    case '8': return glyph_8;
    case '9': return glyph_9;
    case 'A': return glyph_A;
    case 'B': return glyph_B;
    case 'C': return glyph_C;
    case 'D': return glyph_D;
    case 'E': return glyph_E;
    case 'F': return glyph_F;
    case 'G': return glyph_G;
    case 'H': return glyph_H;
    case 'I': return glyph_I;
    case 'J': return glyph_J;
    case 'K': return glyph_K;
    case 'L': return glyph_L;
    case 'M': return glyph_M;
    case 'N': return glyph_N;
    case 'O': return glyph_O;
    case 'P': return glyph_P;
    case 'Q': return glyph_Q;
    case 'R': return glyph_R;
    case 'S': return glyph_S;
    case 'T': return glyph_T;
    case 'U': return glyph_U;
    case 'V': return glyph_V;
    case 'W': return glyph_W;
    case 'X': return glyph_X;
    case 'Y': return glyph_Y;
    case 'Z': return glyph_Z;
    default: return glyph_space;
    }
}

static void copy_upper_ascii(char *destination, size_t destination_size, const char *source)
{
    if (destination_size == 0) {
        return;
    }

    size_t index = 0;
    while (index + 1 < destination_size && source != NULL && source[index] != '\0') {
        destination[index] = normalize_font_char(source[index]);
        index++;
    }
    destination[index] = '\0';
}

static void build_status_screen(status_screen_t *screen, const char *board_line, const char *transport_line, const char *output_line, const identity_record_t *identity, bool storage_ok)
{
    memset(screen, 0, sizeof(*screen));
    copy_upper_ascii(screen->title, sizeof(screen->title), "ESP MSG");
    copy_upper_ascii(screen->board, sizeof(screen->board), board_line);
    copy_upper_ascii(screen->transport, sizeof(screen->transport), transport_line);
    copy_upper_ascii(screen->output, sizeof(screen->output), output_line);

    if (!storage_ok) {
        copy_upper_ascii(screen->status, sizeof(screen->status), "STORE ERR");
        copy_upper_ascii(screen->key, sizeof(screen->key), "KEY UNKNOWN");
        return;
    }

    if (identity != NULL && identity->present) {
        char *fingerprint_hex = NULL;
        char *key_id = NULL;
        if (build_identity_labels(identity, &fingerprint_hex, &key_id) == ESP_OK) {
            char key_line[STATUS_SCREEN_MAX_LINE + 1];
            snprintf(key_line, sizeof(key_line), "KEY %.8s", fingerprint_hex);
            copy_upper_ascii(screen->status, sizeof(screen->status), "STATUS READY");
            copy_upper_ascii(screen->key, sizeof(screen->key), key_line);
        } else {
            copy_upper_ascii(screen->status, sizeof(screen->status), "KEY ERR");
            copy_upper_ascii(screen->key, sizeof(screen->key), "KEY UNKNOWN");
        }
        free(fingerprint_hex);
        free(key_id);
    } else {
        copy_upper_ascii(screen->status, sizeof(screen->status), "STATUS NO ID");
        copy_upper_ascii(screen->key, sizeof(screen->key), "KEY NONE");
    }
}

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
static void apa102_write_bit(int bit)
{
    gpio_set_level(TDONGLE_PIN_APA102_DATA, bit ? 1 : 0);
    esp_rom_delay_us(1);
    gpio_set_level(TDONGLE_PIN_APA102_CLK, 1);
    esp_rom_delay_us(1);
    gpio_set_level(TDONGLE_PIN_APA102_CLK, 0);
}

static void apa102_write_byte(uint8_t value)
{
    for (int bit = 7; bit >= 0; bit--) {
        apa102_write_bit((value >> bit) & 0x01);
    }
}

static void apa102_write_color(uint8_t red, uint8_t green, uint8_t blue, uint8_t brightness)
{
    for (int index = 0; index < 4; index++) {
        apa102_write_byte(0x00);
    }
    apa102_write_byte(0xE0 | (brightness & 0x1F));
    apa102_write_byte(blue);
    apa102_write_byte(green);
    apa102_write_byte(red);
    for (int index = 0; index < 4; index++) {
        apa102_write_byte(0xFF);
    }
}

static esp_err_t test_tdongle_rgb_led(const char **detail)
{
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_APA102_CLK));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_APA102_DATA));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_APA102_CLK, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_APA102_DATA, GPIO_MODE_OUTPUT));
    gpio_set_level(TDONGLE_PIN_APA102_CLK, 0);
    gpio_set_level(TDONGLE_PIN_APA102_DATA, 0);

    apa102_write_color(255, 0, 0, 31);
    vTaskDelay(pdMS_TO_TICKS(180));
    apa102_write_color(0, 255, 0, 31);
    vTaskDelay(pdMS_TO_TICKS(180));
    apa102_write_color(0, 0, 255, 31);
    vTaskDelay(pdMS_TO_TICKS(180));
    apa102_write_color(0, 0, 0, 0);

    *detail = "APA102 RGB LED cycled red, green, blue, then off.";
    return ESP_OK;
}

static esp_err_t tdongle_backlight_init(void)
{
    ledc_timer_config_t timer_config = {
        .speed_mode = TDONGLE_BACKLIGHT_LEDC_MODE,
        .timer_num = TDONGLE_BACKLIGHT_LEDC_TIMER,
        .duty_resolution = TDONGLE_BACKLIGHT_LEDC_RESOLUTION,
        .freq_hz = TDONGLE_BACKLIGHT_LEDC_FREQUENCY_HZ,
        .clk_cfg = LEDC_AUTO_CLK
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer_config), TAG, "Backlight LEDC timer config failed");

    ledc_channel_config_t channel_config = {
        .gpio_num = TDONGLE_PIN_LCD_BL,
        .speed_mode = TDONGLE_BACKLIGHT_LEDC_MODE,
        .channel = TDONGLE_BACKLIGHT_LEDC_CHANNEL,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = TDONGLE_BACKLIGHT_LEDC_TIMER,
        .duty = 0,
        .hpoint = 0,
        .sleep_mode = LEDC_SLEEP_MODE_NO_ALIVE_NO_PD
    };
    return ledc_channel_config(&channel_config);
}

static esp_err_t tdongle_backlight_set_percent(uint32_t percent)
{
    if (percent > 100) {
        percent = 100;
    }

    uint32_t duty = (TDONGLE_BACKLIGHT_LEDC_MAX_DUTY * percent) / 100;
    ESP_RETURN_ON_ERROR(
        ledc_set_duty(TDONGLE_BACKLIGHT_LEDC_MODE, TDONGLE_BACKLIGHT_LEDC_CHANNEL, duty),
        TAG,
        "Backlight duty update failed");
    return ledc_update_duty(TDONGLE_BACKLIGHT_LEDC_MODE, TDONGLE_BACKLIGHT_LEDC_CHANNEL);
}

static esp_err_t tdongle_lcd_send(spi_device_handle_t handle, int dc_level, const uint8_t *data, size_t length);
static esp_err_t tdongle_lcd_send_command(spi_device_handle_t handle, uint8_t command);
static esp_err_t tdongle_lcd_send_data(spi_device_handle_t handle, const uint8_t *data, size_t length);
static esp_err_t tdongle_lcd_set_window(spi_device_handle_t handle, uint16_t xs, uint16_t ys, uint16_t xe, uint16_t ye);
static esp_err_t tdongle_lcd_fill_color(spi_device_handle_t handle, uint16_t color);

static esp_err_t tdongle_lcd_open(spi_device_handle_t *handle, bool sweep_backlight)
{
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_LCD_DC));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_LCD_RST));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_LCD_DC, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_LCD_RST, GPIO_MODE_OUTPUT));

    esp_err_t result = tdongle_backlight_init();
    if (result != ESP_OK) {
        return result;
    }
    ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(sweep_backlight ? 12 : 75), TAG, "Backlight initial level failed");
    if (sweep_backlight) {
        vTaskDelay(pdMS_TO_TICKS(60));
        ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(45), TAG, "Backlight mid level failed");
        vTaskDelay(pdMS_TO_TICKS(90));
        ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(100), TAG, "Backlight max level failed");
    }

    spi_bus_config_t bus_config = {
        .mosi_io_num = TDONGLE_PIN_LCD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = TDONGLE_PIN_LCD_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 128
    };
    spi_device_interface_config_t device_config = {
        .clock_speed_hz = SPI_MASTER_FREQ_20M,
        .mode = 0,
        .spics_io_num = TDONGLE_PIN_LCD_CS,
        .queue_size = 1
    };

    result = spi_bus_initialize(TDONGLE_DISPLAY_HOST, &bus_config, SPI_DMA_CH_AUTO);
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        return result;
    }

    result = spi_bus_add_device(TDONGLE_DISPLAY_HOST, &device_config, handle);
    if (result != ESP_OK) {
        return result;
    }

    gpio_set_level(TDONGLE_PIN_LCD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(TDONGLE_PIN_LCD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(120));

    const uint8_t frmctr1[] = {0x01, 0x2C, 0x2D};
    const uint8_t frmctr2[] = {0x01, 0x2C, 0x2D};
    const uint8_t frmctr3[] = {0x01, 0x2C, 0x2D, 0x01, 0x2C, 0x2D};
    const uint8_t invctr[] = {0x07};
    const uint8_t pwctr1[] = {0xA2, 0x02, 0x84};
    const uint8_t pwctr2[] = {0xC5};
    const uint8_t pwctr3[] = {0x0A, 0x00};
    const uint8_t pwctr4[] = {0x8A, 0x2A};
    const uint8_t pwctr5[] = {0x8A, 0xEE};
    const uint8_t vmctr1[] = {0x0E};
    const uint8_t madctl[] = {0xC8};
    const uint8_t colmod[] = {0x05};

    result = tdongle_lcd_send_command(*handle, 0x01);
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(150));
        result = tdongle_lcd_send_command(*handle, 0x11);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(120));
        result = tdongle_lcd_send_command(*handle, 0xB1);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, frmctr1, sizeof(frmctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xB2);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, frmctr2, sizeof(frmctr2));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xB3);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, frmctr3, sizeof(frmctr3));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xB4);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, invctr, sizeof(invctr));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC0);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, pwctr1, sizeof(pwctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC1);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, pwctr2, sizeof(pwctr2));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC2);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, pwctr3, sizeof(pwctr3));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC3);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, pwctr4, sizeof(pwctr4));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC4);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, pwctr5, sizeof(pwctr5));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0xC5);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, vmctr1, sizeof(vmctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0x36);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, madctl, sizeof(madctl));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0x3A);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(*handle, colmod, sizeof(colmod));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(*handle, 0x13);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(10));
        result = tdongle_lcd_send_command(*handle, 0x29);
    }

    if (result != ESP_OK) {
        spi_bus_remove_device(*handle);
        *handle = NULL;
    }
    return result;
}

static void tdongle_lcd_close(spi_device_handle_t handle)
{
    if (handle != NULL) {
        spi_bus_remove_device(handle);
    }
}

static esp_err_t tdongle_lcd_fill_rect(spi_device_handle_t handle, uint16_t x, uint16_t y, uint16_t width, uint16_t height, uint16_t color)
{
    if (width == 0 || height == 0) {
        return ESP_OK;
    }

    uint8_t pixel[2] = {
        (uint8_t) ((color >> 8) & 0xFF),
        (uint8_t) (color & 0xFF)
    };
    uint8_t chunk[128];
    for (size_t index = 0; index < sizeof(chunk); index += 2) {
        chunk[index] = pixel[0];
        chunk[index + 1] = pixel[1];
    }

    esp_err_t result = tdongle_lcd_set_window(handle, x, y, x + width - 1, y + height - 1);
    if (result != ESP_OK) {
        return result;
    }

    size_t total_pixels = width * height;
    size_t written_pixels = 0;
    while (written_pixels < total_pixels) {
        size_t pixels_this_round = (total_pixels - written_pixels) > 64 ? 64 : (total_pixels - written_pixels);
        result = tdongle_lcd_send_data(handle, chunk, pixels_this_round * 2);
        if (result != ESP_OK) {
            return result;
        }
        written_pixels += pixels_this_round;
    }

    return ESP_OK;
}

static esp_err_t tdongle_lcd_draw_char(spi_device_handle_t handle, uint16_t x, uint16_t y, char c, uint16_t color)
{
    const uint8_t *pattern = font5x7_pattern(c);
    for (uint16_t column = 0; column < FONT5X7_WIDTH; column++) {
        for (uint16_t row = 0; row < FONT5X7_HEIGHT; row++) {
            if ((pattern[column] >> row) & 0x01) {
                esp_err_t result = tdongle_lcd_fill_rect(
                    handle,
                    TDONGLE_LCD_X_OFFSET + x + column,
                    TDONGLE_LCD_Y_OFFSET + y + row,
                    1,
                    1,
                    color);
                if (result != ESP_OK) {
                    return result;
                }
            }
        }
    }
    return ESP_OK;
}

static esp_err_t tdongle_lcd_draw_text(spi_device_handle_t handle, uint16_t x, uint16_t y, const char *text, uint16_t color)
{
    uint16_t cursor_x = x;
    while (text != NULL && *text != '\0') {
        esp_err_t result = tdongle_lcd_draw_char(handle, cursor_x, y, *text, color);
        if (result != ESP_OK) {
            return result;
        }
        cursor_x += FONT5X7_WIDTH + FONT5X7_SPACING;
        text++;
    }
    return ESP_OK;
}

static esp_err_t render_tdongle_status_screen(const identity_record_t *identity, bool storage_ok)
{
    status_screen_t screen = {0};
    build_status_screen(&screen, "TDONGLE S3", "USB-JTAG", "DISPLAY OK", identity, storage_ok);

    spi_device_handle_t handle = NULL;
    esp_err_t result = tdongle_lcd_open(&handle, false);
    if (result != ESP_OK) {
        return result;
    }

    result = tdongle_lcd_fill_color(handle, 0x0000);
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 4, screen.title, 0xFFFF);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 18, screen.board, 0xFFE0);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 32, screen.status, 0x07FF);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 46, screen.transport, 0xF81F);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 60, screen.key, 0x07E0);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_draw_text(handle, 1, 74, screen.output, 0xFFFF);
    }

    tdongle_lcd_close(handle);
    return result;
}

static esp_err_t tdongle_lcd_send(spi_device_handle_t handle, int dc_level, const uint8_t *data, size_t length)
{
    if (length == 0) {
        return ESP_OK;
    }

    gpio_set_level(TDONGLE_PIN_LCD_DC, dc_level);
    spi_transaction_t transaction = {0};
    transaction.length = length * 8;
    transaction.tx_buffer = data;
    return spi_device_polling_transmit(handle, &transaction);
}

static esp_err_t tdongle_lcd_send_command(spi_device_handle_t handle, uint8_t command)
{
    return tdongle_lcd_send(handle, 0, &command, 1);
}

static esp_err_t tdongle_lcd_send_data(spi_device_handle_t handle, const uint8_t *data, size_t length)
{
    return tdongle_lcd_send(handle, 1, data, length);
}

static esp_err_t tdongle_lcd_set_window(spi_device_handle_t handle, uint16_t xs, uint16_t ys, uint16_t xe, uint16_t ye)
{
    uint8_t column_data[] = {
        (uint8_t) ((xs >> 8) & 0xFF),
        (uint8_t) (xs & 0xFF),
        (uint8_t) ((xe >> 8) & 0xFF),
        (uint8_t) (xe & 0xFF)
    };
    uint8_t row_data[] = {
        (uint8_t) ((ys >> 8) & 0xFF),
        (uint8_t) (ys & 0xFF),
        (uint8_t) ((ye >> 8) & 0xFF),
        (uint8_t) (ye & 0xFF)
    };

    esp_err_t result = tdongle_lcd_send_command(handle, 0x2A);
    if (result != ESP_OK) {
        return result;
    }
    result = tdongle_lcd_send_data(handle, column_data, sizeof(column_data));
    if (result != ESP_OK) {
        return result;
    }
    result = tdongle_lcd_send_command(handle, 0x2B);
    if (result != ESP_OK) {
        return result;
    }
    result = tdongle_lcd_send_data(handle, row_data, sizeof(row_data));
    if (result != ESP_OK) {
        return result;
    }
    return tdongle_lcd_send_command(handle, 0x2C);
}

static esp_err_t tdongle_lcd_fill_color(spi_device_handle_t handle, uint16_t color)
{
    uint8_t pixel[2] = {
        (uint8_t) ((color >> 8) & 0xFF),
        (uint8_t) (color & 0xFF)
    };
    uint8_t chunk[128];
    for (size_t index = 0; index < sizeof(chunk); index += 2) {
        chunk[index] = pixel[0];
        chunk[index + 1] = pixel[1];
    }

    esp_err_t result = tdongle_lcd_set_window(
        handle,
        TDONGLE_LCD_X_OFFSET,
        TDONGLE_LCD_Y_OFFSET,
        TDONGLE_LCD_X_OFFSET + TDONGLE_LCD_WIDTH - 1,
        TDONGLE_LCD_Y_OFFSET + TDONGLE_LCD_HEIGHT - 1);
    if (result != ESP_OK) {
        return result;
    }

    const size_t total_pixels = TDONGLE_LCD_WIDTH * TDONGLE_LCD_HEIGHT;
    size_t written_pixels = 0;
    while (written_pixels < total_pixels) {
        const size_t pixels_this_round = (total_pixels - written_pixels) > 64 ? 64 : (total_pixels - written_pixels);
        result = tdongle_lcd_send_data(handle, chunk, pixels_this_round * 2);
        if (result != ESP_OK) {
            return result;
        }
        written_pixels += pixels_this_round;
    }

    return ESP_OK;
}

static esp_err_t test_tdongle_display(const char **detail)
{
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_LCD_DC));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_reset_pin(TDONGLE_PIN_LCD_RST));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_LCD_DC, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_set_direction(TDONGLE_PIN_LCD_RST, GPIO_MODE_OUTPUT));

    esp_err_t result = tdongle_backlight_init();
    if (result != ESP_OK) {
        return result;
    }
    ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(12), TAG, "Backlight start level failed");
    vTaskDelay(pdMS_TO_TICKS(60));
    ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(45), TAG, "Backlight mid level failed");
    vTaskDelay(pdMS_TO_TICKS(90));
    ESP_RETURN_ON_ERROR(tdongle_backlight_set_percent(100), TAG, "Backlight max level failed");

    spi_bus_config_t bus_config = {
        .mosi_io_num = TDONGLE_PIN_LCD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = TDONGLE_PIN_LCD_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 128
    };
    spi_device_interface_config_t device_config = {
        .clock_speed_hz = SPI_MASTER_FREQ_20M,
        .mode = 0,
        .spics_io_num = TDONGLE_PIN_LCD_CS,
        .queue_size = 1
    };

    spi_device_handle_t handle = NULL;
    result = spi_bus_initialize(TDONGLE_DISPLAY_HOST, &bus_config, SPI_DMA_CH_AUTO);
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        return result;
    }

    result = spi_bus_add_device(TDONGLE_DISPLAY_HOST, &device_config, &handle);
    if (result != ESP_OK) {
        return result;
    }

    gpio_set_level(TDONGLE_PIN_LCD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(TDONGLE_PIN_LCD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(120));

    const uint8_t frmctr1[] = {0x01, 0x2C, 0x2D};
    const uint8_t frmctr2[] = {0x01, 0x2C, 0x2D};
    const uint8_t frmctr3[] = {0x01, 0x2C, 0x2D, 0x01, 0x2C, 0x2D};
    const uint8_t invctr[] = {0x07};
    const uint8_t pwctr1[] = {0xA2, 0x02, 0x84};
    const uint8_t pwctr2[] = {0xC5};
    const uint8_t pwctr3[] = {0x0A, 0x00};
    const uint8_t pwctr4[] = {0x8A, 0x2A};
    const uint8_t pwctr5[] = {0x8A, 0xEE};
    const uint8_t vmctr1[] = {0x0E};
    const uint8_t madctl[] = {0xC8};
    const uint8_t colmod[] = {0x05};

    result = tdongle_lcd_send_command(handle, 0x01);
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(150));
        result = tdongle_lcd_send_command(handle, 0x11);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(120));
        result = tdongle_lcd_send_command(handle, 0xB1);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, frmctr1, sizeof(frmctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xB2);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, frmctr2, sizeof(frmctr2));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xB3);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, frmctr3, sizeof(frmctr3));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xB4);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, invctr, sizeof(invctr));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC0);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, pwctr1, sizeof(pwctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC1);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, pwctr2, sizeof(pwctr2));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC2);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, pwctr3, sizeof(pwctr3));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC3);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, pwctr4, sizeof(pwctr4));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC4);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, pwctr5, sizeof(pwctr5));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0xC5);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, vmctr1, sizeof(vmctr1));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0x36);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, madctl, sizeof(madctl));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0x3A);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_data(handle, colmod, sizeof(colmod));
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_send_command(handle, 0x13);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(10));
        result = tdongle_lcd_send_command(handle, 0x29);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(100));
        result = tdongle_backlight_set_percent(25);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_fill_color(handle, 0xF800);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(180));
        result = tdongle_backlight_set_percent(55);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_fill_color(handle, 0x07E0);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(180));
        result = tdongle_backlight_set_percent(100);
    }
    if (result == ESP_OK) {
        result = tdongle_lcd_fill_color(handle, 0x001F);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(180));
        result = tdongle_lcd_fill_color(handle, 0xFFFF);
    }
    if (result == ESP_OK) {
        result = tdongle_backlight_set_percent(15);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(220));
        result = tdongle_backlight_set_percent(100);
    }

    spi_bus_remove_device(handle);
    *detail = result == ESP_OK
        ? "ST7735 display reset, initialized, filled with RGB plus white, and backlight swept from dim to full brightness."
        : "ST7735 display test failed during SPI transfer, panel init, or backlight PWM control.";
    return result;
}
#endif

#if defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
static esp_err_t oled_write_bytes(uint8_t address, uint8_t control, const uint8_t *data, size_t length)
{
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    if (cmd == NULL) {
        return ESP_ERR_NO_MEM;
    }

    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (address << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, control, true);
    if (length > 0) {
        i2c_master_write(cmd, (uint8_t *) data, length, true);
    }
    i2c_master_stop(cmd);
    esp_err_t result = i2c_master_cmd_begin(I2C_NUM_0, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);
    return result;
}

static esp_err_t host_oled_init_bus_and_panel(const oled_probe_result_t *oled, uint32_t clock_hz)
{
    i2c_config_t config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = oled->sda,
        .scl_io_num = oled->scl,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = clock_hz
    };

    ESP_RETURN_ON_ERROR(i2c_param_config(I2C_NUM_0, &config), TAG, "OLED param config failed");
    esp_err_t result = i2c_driver_install(I2C_NUM_0, config.mode, 0, 0, 0);
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
        return result;
    }

    const uint8_t init_sequence[] = {
        0xAE, 0x20, 0x02, 0xB0, 0xC8, 0x00, 0x10, 0x40,
        0x81, 0x7F, 0xA1, 0xA6, 0xA8, 0x3F, 0xA4, 0xD3,
        0x00, 0xD5, 0x80, 0xD9, 0xF1, 0xDA, 0x12, 0xDB,
        0x40, 0x8D, 0x14, 0xAF
    };
    ESP_RETURN_ON_ERROR(oled_write_bytes((uint8_t) oled->address, 0x00, init_sequence, sizeof(init_sequence)), TAG, "OLED init sequence failed");
    return ESP_OK;
}

static esp_err_t host_oled_write_frame(const oled_probe_result_t *oled, const uint8_t *framebuffer, size_t length)
{
    ESP_RETURN_ON_ERROR(host_oled_init_bus_and_panel(oled, 400000), TAG, "OLED bus init failed");

    esp_err_t result = ESP_OK;
    for (int page = 0; page < HOST_OLED_PAGE_COUNT; page++) {
        const uint8_t page_command[] = {
            (uint8_t) (0xB0 | page),
            (uint8_t) (0x00 | (HOST_OLED_COLUMN_OFFSET & 0x0F)),
            (uint8_t) (0x10 | ((HOST_OLED_COLUMN_OFFSET >> 4) & 0x0F))
        };
        result = oled_write_bytes((uint8_t) oled->address, 0x00, page_command, sizeof(page_command));
        if (result != ESP_OK) {
            break;
        }

        size_t page_offset = (size_t) page * HOST_OLED_WIDTH;
        size_t page_length = (length - page_offset) > HOST_OLED_WIDTH ? HOST_OLED_WIDTH : (length - page_offset);
        result = oled_write_bytes((uint8_t) oled->address, 0x40, framebuffer + page_offset, page_length);
        if (result != ESP_OK) {
            break;
        }
    }
    i2c_driver_delete(I2C_NUM_0);
    return result;
}

static tft_candidate_t tft_probe_to_candidate(const tft_probe_result_t *tft)
{
    return (tft_candidate_t) {
        .mosi = tft->mosi,
        .miso = tft->miso,
        .sclk = tft->sclk,
        .cs = tft->cs,
        .dc = tft->dc,
        .rst = tft->rst,
        .bl = tft->bl,
        .label = "detected-ili9341"
    };
}

static esp_err_t host_ili9341_panel_init_candidate(const tft_candidate_t *candidate, spi_device_handle_t handle)
{
    const uint8_t positive_gamma[] = {
        0x0F, 0x31, 0x2B, 0x0C, 0x0E, 0x08, 0x4E, 0xF1,
        0x37, 0x07, 0x10, 0x03, 0x0E, 0x09, 0x00
    };
    const uint8_t negative_gamma[] = {
        0x00, 0x0E, 0x14, 0x03, 0x11, 0x07, 0x31, 0xC1,
        0x48, 0x08, 0x0F, 0x0C, 0x31, 0x36, 0x0F
    };

    esp_err_t result = host_spi_panel_send_command(candidate, handle, 0x01);
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(150));
        result = host_spi_panel_send_command(candidate, handle, 0x28);
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0x3A);
    }
    if (result == ESP_OK) {
        const uint8_t colmod[] = {0x55};
        result = host_spi_panel_send_data(candidate, handle, colmod, sizeof(colmod));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0x36);
    }
    if (result == ESP_OK) {
        const uint8_t madctl[] = {0x48};
        result = host_spi_panel_send_data(candidate, handle, madctl, sizeof(madctl));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0xB1);
    }
    if (result == ESP_OK) {
        const uint8_t frmctl[] = {0x00, 0x18};
        result = host_spi_panel_send_data(candidate, handle, frmctl, sizeof(frmctl));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0xF2);
    }
    if (result == ESP_OK) {
        const uint8_t gamma_off[] = {0x00};
        result = host_spi_panel_send_data(candidate, handle, gamma_off, sizeof(gamma_off));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0x26);
    }
    if (result == ESP_OK) {
        const uint8_t gamma_curve[] = {0x01};
        result = host_spi_panel_send_data(candidate, handle, gamma_curve, sizeof(gamma_curve));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0xE0);
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_data(candidate, handle, positive_gamma, sizeof(positive_gamma));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0xE1);
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_data(candidate, handle, negative_gamma, sizeof(negative_gamma));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(candidate, handle, 0x11);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(120));
        result = host_spi_panel_send_command(candidate, handle, 0x29);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(30));
    }
    return result;
}

static esp_err_t host_ili9341_panel_init(const tft_probe_result_t *tft, spi_device_handle_t handle)
{
    const tft_candidate_t candidate = tft_probe_to_candidate(tft);
    return host_ili9341_panel_init_candidate(&candidate, handle);
}

static esp_err_t host_ili9341_open(const tft_probe_result_t *tft, spi_device_handle_t *handle, int clock_hz)
{
    const tft_candidate_t candidate = tft_probe_to_candidate(tft);
    esp_err_t result = host_spi_panel_open(&candidate, handle, clock_hz);
    if (result != ESP_OK) {
        return result;
    }

    result = host_ili9341_panel_init(tft, *handle);
    if (result != ESP_OK) {
        host_spi_panel_close(*handle);
        *handle = NULL;
    }
    return result;
}

static esp_err_t host_ili9341_set_window(const tft_probe_result_t *tft, spi_device_handle_t handle, uint16_t xs, uint16_t ys, uint16_t xe, uint16_t ye)
{
    const tft_candidate_t candidate = tft_probe_to_candidate(tft);
    uint8_t column_data[] = {
        (uint8_t) ((xs >> 8) & 0xFF), (uint8_t) (xs & 0xFF),
        (uint8_t) ((xe >> 8) & 0xFF), (uint8_t) (xe & 0xFF)
    };
    uint8_t row_data[] = {
        (uint8_t) ((ys >> 8) & 0xFF), (uint8_t) (ys & 0xFF),
        (uint8_t) ((ye >> 8) & 0xFF), (uint8_t) (ye & 0xFF)
    };

    esp_err_t result = host_spi_panel_send_command(&candidate, handle, 0x2A);
    if (result == ESP_OK) {
        result = host_spi_panel_send_data(&candidate, handle, column_data, sizeof(column_data));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(&candidate, handle, 0x2B);
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_data(&candidate, handle, row_data, sizeof(row_data));
    }
    if (result == ESP_OK) {
        result = host_spi_panel_send_command(&candidate, handle, 0x2C);
    }
    return result;
}

static esp_err_t host_ili9341_fill_rect(const tft_probe_result_t *tft, spi_device_handle_t handle, uint16_t x, uint16_t y, uint16_t width, uint16_t height, uint16_t color)
{
    if (width == 0 || height == 0) {
        return ESP_OK;
    }

    uint8_t pixel[2] = {
        (uint8_t) ((color >> 8) & 0xFF),
        (uint8_t) (color & 0xFF)
    };
    uint8_t chunk[256];
    for (size_t index = 0; index < sizeof(chunk); index += 2) {
        chunk[index] = pixel[0];
        chunk[index + 1] = pixel[1];
    }

    const tft_candidate_t candidate = tft_probe_to_candidate(tft);
    esp_err_t result = host_ili9341_set_window(tft, handle, x, y, x + width - 1, y + height - 1);
    if (result != ESP_OK) {
        return result;
    }

    size_t total_pixels = width * height;
    size_t written_pixels = 0;
    while (written_pixels < total_pixels) {
        size_t pixels_this_round = (total_pixels - written_pixels) > 128 ? 128 : (total_pixels - written_pixels);
        result = host_spi_panel_send_data(&candidate, handle, chunk, pixels_this_round * 2);
        if (result != ESP_OK) {
            return result;
        }
        written_pixels += pixels_this_round;
    }

    return ESP_OK;
}

static esp_err_t host_ili9341_fill_color(const tft_probe_result_t *tft, spi_device_handle_t handle, uint16_t color)
{
    return host_ili9341_fill_rect(tft, handle, 0, 0, HOST_ILI9341_WIDTH, HOST_ILI9341_HEIGHT, color);
}

static esp_err_t host_ili9341_draw_char(const tft_probe_result_t *tft, spi_device_handle_t handle, uint16_t x, uint16_t y, char c, uint16_t color, uint16_t scale)
{
    const uint8_t *pattern = font5x7_pattern(c);
    for (uint16_t column = 0; column < FONT5X7_WIDTH; column++) {
        for (uint16_t row = 0; row < FONT5X7_HEIGHT; row++) {
            if (((pattern[column] >> row) & 0x01) != 0) {
                esp_err_t result = host_ili9341_fill_rect(
                    tft,
                    handle,
                    x + (column * scale),
                    y + (row * scale),
                    scale,
                    scale,
                    color);
                if (result != ESP_OK) {
                    return result;
                }
            }
        }
    }
    return ESP_OK;
}

static esp_err_t host_ili9341_draw_text(const tft_probe_result_t *tft, spi_device_handle_t handle, uint16_t x, uint16_t y, const char *text, uint16_t color, uint16_t scale)
{
    uint16_t cursor_x = x;
    while (text != NULL && *text != '\0') {
        esp_err_t result = host_ili9341_draw_char(tft, handle, cursor_x, y, *text, color, scale);
        if (result != ESP_OK) {
            return result;
        }
        cursor_x += (FONT5X7_WIDTH + FONT5X7_SPACING) * scale;
        text++;
    }
    return ESP_OK;
}

static esp_err_t host_ili9341_draw_blind_pattern(const tft_probe_result_t *tft, spi_device_handle_t handle, size_t preset_index)
{
    static const uint16_t bar_colors[] = {
        0xF800, 0x07E0, 0x001F, 0xFFE0, 0xF81F, 0x07FF, 0xFFFF, 0xFD20
    };

    esp_err_t result = host_ili9341_fill_color(tft, handle, 0x0000);
    if (result != ESP_OK) {
        return result;
    }

    result = host_ili9341_fill_rect(tft, handle, 0, 0, HOST_ILI9341_WIDTH, 24, 0xFFFF);
    if (result != ESP_OK) {
        return result;
    }

    size_t bar_count = preset_index + 1;
    if (bar_count > (sizeof(bar_colors) / sizeof(bar_colors[0]))) {
        bar_count = sizeof(bar_colors) / sizeof(bar_colors[0]);
    }

    const uint16_t top = 40;
    const uint16_t bar_height = 220;
    const uint16_t gap = 8;
    const uint16_t usable_width = HOST_ILI9341_WIDTH - ((uint16_t) (bar_count + 1) * gap);
    const uint16_t bar_width = bar_count > 0 ? usable_width / (uint16_t) bar_count : 0;

    for (size_t index = 0; index < bar_count; index++) {
        uint16_t x = gap + (uint16_t) index * (bar_width + gap);
        result = host_ili9341_fill_rect(
            tft,
            handle,
            x,
            top,
            bar_width,
            bar_height,
            bar_colors[index % (sizeof(bar_colors) / sizeof(bar_colors[0]))]);
        if (result != ESP_OK) {
            return result;
        }
    }

    return ESP_OK;
}

static esp_err_t render_host_ili9341_status_screen_with_tft(const tft_probe_result_t *tft, const identity_record_t *identity, bool storage_ok)
{
    if (tft == NULL || !tft->detected) {
        return ESP_ERR_NOT_FOUND;
    }

    status_screen_t screen = {0};
    build_status_screen(&screen, "HOST ESP32", "UART0", "ILI9341 OK", identity, storage_ok);

    spi_device_handle_t handle = NULL;
    esp_err_t result = host_ili9341_open(tft, &handle, SPI_MASTER_FREQ_20M);
    if (result != ESP_OK) {
        return result;
    }

    bool learned_blind = s_cached_blind_tft_persisted &&
        s_cached_blind_tft.detected &&
        s_cached_blind_tft.tft.mosi == tft->mosi &&
        s_cached_blind_tft.tft.miso == tft->miso &&
        s_cached_blind_tft.tft.sclk == tft->sclk &&
        s_cached_blind_tft.tft.cs == tft->cs &&
        s_cached_blind_tft.tft.dc == tft->dc &&
        s_cached_blind_tft.tft.rst == tft->rst;

    if (learned_blind && s_cached_blind_tft.candidate_index >= 0) {
        result = host_ili9341_draw_blind_pattern(tft, handle, (size_t) s_cached_blind_tft.candidate_index);
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 8, screen.title, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 284, HOST_ILI9341_WIDTH, 36, 0x0000);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 288, screen.board, 0xFFFF, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 300, screen.status, 0xFFFF, 1);
        }
    } else {
        result = host_ili9341_fill_color(tft, handle, 0x0010);
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 0, HOST_ILI9341_WIDTH, 36, 0xFFFF);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 40, HOST_ILI9341_WIDTH, 36, 0xFD20);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 80, HOST_ILI9341_WIDTH, 36, storage_ok ? 0x07E0 : 0xF800);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 120, HOST_ILI9341_WIDTH, 36, 0x7BEF);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 160, HOST_ILI9341_WIDTH, 36, 0x07FF);
        }
        if (result == ESP_OK) {
            result = host_ili9341_fill_rect(tft, handle, 0, 200, HOST_ILI9341_WIDTH, 36, 0xFFE0);
        }

        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 10, screen.title, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 50, screen.board, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 90, screen.status, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 130, screen.transport, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 170, screen.key, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
        if (result == ESP_OK) {
            result = host_ili9341_draw_text(tft, handle, 8, 210, screen.output, 0x0000, HOST_ILI9341_TEXT_SCALE);
        }
    }

    host_spi_panel_close(handle);
    return result;
}

static esp_err_t render_host_ili9341_status_screen(const identity_record_t *identity, bool storage_ok)
{
    tft_probe_result_t tft = get_known_ili9341_output();
    return render_host_ili9341_status_screen_with_tft(&tft, identity, storage_ok);
}

static esp_err_t test_host_ili9341(const char **detail)
{
    tft_probe_result_t tft = get_known_ili9341_output();
    if (!tft.detected) {
        esp_err_t last_result = ESP_ERR_NOT_FOUND;
        for (size_t index = 0; index < sizeof(HOST_ILI9341_CANDIDATES) / sizeof(HOST_ILI9341_CANDIDATES[0]); index++) {
            spi_device_handle_t handle = NULL;
            last_result = host_spi_panel_open(&HOST_ILI9341_CANDIDATES[index], &handle, SPI_MASTER_FREQ_20M);
            if (last_result != ESP_OK) {
                continue;
            }

              last_result = host_ili9341_panel_init_candidate(&HOST_ILI9341_CANDIDATES[index], handle);
              if (last_result == ESP_OK) {
                  tft_probe_result_t blind_tft = {
                    .detected = true,
                    .mosi = HOST_ILI9341_CANDIDATES[index].mosi,
                    .miso = HOST_ILI9341_CANDIDATES[index].miso,
                    .sclk = HOST_ILI9341_CANDIDATES[index].sclk,
                    .cs = HOST_ILI9341_CANDIDATES[index].cs,
                    .dc = HOST_ILI9341_CANDIDATES[index].dc,
                    .rst = HOST_ILI9341_CANDIDATES[index].rst,
                      .bl = HOST_ILI9341_CANDIDATES[index].bl,
                      .signature = {0x00, 0x00, 0x00, 0x00}
                  };
                  last_result = host_ili9341_draw_blind_pattern(&blind_tft, handle, index);
                  if (last_result == ESP_OK) {
                      s_cached_blind_tft.detected = true;
                      s_cached_blind_tft.candidate_index = (int) index;
                      s_cached_blind_tft.tft = blind_tft;
                      s_cached_blind_tft_persisted = false;
                      vTaskDelay(pdMS_TO_TICKS(900));
                  }
              }

              host_spi_panel_close(handle);
              if (last_result == ESP_OK) {
                  static char blind_detail[160];
                  snprintf(
                      blind_detail,
                      sizeof(blind_detail),
                      "ILI9341 blind write-only preview used preset %u (MOSI=%d MISO=%d SCLK=%d CS=%d DC=%d RST=%d BL=%d). Confirm visually, then save if correct.",
                      (unsigned) (index + 1),
                      HOST_ILI9341_CANDIDATES[index].mosi,
                      HOST_ILI9341_CANDIDATES[index].miso,
                    HOST_ILI9341_CANDIDATES[index].sclk,
                    HOST_ILI9341_CANDIDATES[index].cs,
                    HOST_ILI9341_CANDIDATES[index].dc,
                    HOST_ILI9341_CANDIDATES[index].rst,
                    HOST_ILI9341_CANDIDATES[index].bl);
                *detail = blind_detail;
                return ESP_OK;
            }
        }

        *detail = "No ILI9341 display detected on common SPI pin presets, and no blind SPI preset could be initialized.";
        return ESP_ERR_NOT_FOUND;
    }

    spi_device_handle_t handle = NULL;
    esp_err_t result = host_ili9341_open(&tft, &handle, SPI_MASTER_FREQ_20M);
    if (result != ESP_OK) {
        *detail = "ILI9341 display test failed during SPI bus or panel init.";
        return result;
    }

    result = host_ili9341_fill_color(&tft, handle, 0xF800);
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(160));
        result = host_ili9341_fill_color(&tft, handle, 0x07E0);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(160));
        result = host_ili9341_fill_color(&tft, handle, 0x001F);
    }
    if (result == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(160));
        result = host_ili9341_fill_color(&tft, handle, 0xFFFF);
    }

    host_spi_panel_close(handle);
    *detail = result == ESP_OK
        ? "ILI9341-compatible TFT initialized and filled with RGB plus white test frames."
        : "ILI9341-compatible TFT test failed during SPI transfer or panel init.";
    return result;
}

static esp_err_t preview_host_ili9341_sweep(const char **detail)
{
    for (size_t index = 0; index < sizeof(HOST_ILI9341_CANDIDATES) / sizeof(HOST_ILI9341_CANDIDATES[0]); index++) {
        spi_device_handle_t handle = NULL;
        esp_err_t result = host_spi_panel_open(&HOST_ILI9341_CANDIDATES[index], &handle, SPI_MASTER_FREQ_20M);
        if (result != ESP_OK) {
            continue;
        }

        result = host_ili9341_panel_init_candidate(&HOST_ILI9341_CANDIDATES[index], handle);
        if (result == ESP_OK) {
            tft_probe_result_t tft = {
                .detected = true,
                .mosi = HOST_ILI9341_CANDIDATES[index].mosi,
                .miso = HOST_ILI9341_CANDIDATES[index].miso,
                .sclk = HOST_ILI9341_CANDIDATES[index].sclk,
                .cs = HOST_ILI9341_CANDIDATES[index].cs,
                .dc = HOST_ILI9341_CANDIDATES[index].dc,
                .rst = HOST_ILI9341_CANDIDATES[index].rst,
                .bl = HOST_ILI9341_CANDIDATES[index].bl,
                .signature = {0x00, 0x00, 0x00, 0x00}
            };
            result = host_ili9341_draw_blind_pattern(&tft, handle, index);
            if (result == ESP_OK) {
                vTaskDelay(pdMS_TO_TICKS(1200));
            }
        }

        host_spi_panel_close(handle);
    }

    *detail = "ILI9341 preset sweep sent. Look for a dark screen with a white top band and N vertical colored bars, then report the visible preset number.";
    return ESP_OK;
}

static esp_err_t render_host_ili9341_status_preview(const char **detail)
{
    identity_record_t identity = {0};
    esp_err_t storage_status = load_identity(&identity);
    if (storage_status != ESP_OK) {
        memset(&identity, 0, sizeof(identity));
    }

    tft_probe_result_t tft = get_known_ili9341_output();
    if (!tft.detected) {
        blind_tft_result_t candidate = blind_tft_result_from_preset_index(0);
        if (candidate.detected) {
            tft = candidate.tft;
            s_cached_blind_tft = candidate;
            s_cached_blind_tft_persisted = false;
        }
    }

    esp_err_t result = render_host_ili9341_status_screen_with_tft(&tft, &identity, storage_status == ESP_OK);
    *detail = result == ESP_OK
        ? "ILI9341 status screen render was requested."
        : "ILI9341 status screen render failed.";
    return result;
}

static esp_err_t persist_current_blind_tft(const char **detail)
{
    if (!s_cached_blind_tft.detected || s_cached_blind_tft.candidate_index < 0) {
        *detail = "No provisional blind TFT preset is cached. Run display test or preset sweep first.";
        return ESP_ERR_NOT_FOUND;
    }

    esp_err_t result = save_learned_host_display_preset(s_cached_blind_tft.candidate_index);
    if (result == ESP_OK) {
        s_cached_blind_tft_persisted = true;
        *detail = "Current blind TFT preset was saved to NVS.";
    } else {
        *detail = "Failed to save current blind TFT preset to NVS.";
    }
    return result;
}

static esp_err_t reset_current_blind_tft(const char **detail)
{
    esp_err_t result = clear_learned_host_display_preset();
    if (result == ESP_OK) {
        s_cached_blind_tft.detected = false;
        s_cached_blind_tft.candidate_index = -1;
        s_cached_blind_tft.tft.detected = false;
        s_cached_blind_tft_persisted = false;
        *detail = "Learned blind TFT preset was cleared.";
    } else {
        *detail = "Failed to clear learned blind TFT preset.";
    }
    return result;
}

static esp_err_t render_host_oled_status_screen(const identity_record_t *identity, bool storage_ok)
{
    oled_probe_result_t oled = get_known_oled_output();
    if (!oled.detected) {
        return ESP_ERR_NOT_FOUND;
    }

    uint8_t framebuffer[OLED_FRAMEBUFFER_SIZE];
    mono_framebuffer_clear(framebuffer, sizeof(framebuffer));

    status_screen_t screen = {0};
    char output_line[STATUS_SCREEN_MAX_LINE + 1];
    snprintf(output_line, sizeof(output_line), "OLED 0X%02X", oled.address);
    build_status_screen(&screen, "HOST ESP32", "UART0", output_line, identity, storage_ok);

    mono_framebuffer_draw_rect(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 0, 128, 64);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 8, 128);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 18, 128);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 28, 128);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 38, 128);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 48, 128);
    mono_framebuffer_draw_hline(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 0, 58, 128);

    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 1, screen.title);
    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 11, screen.board);
    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 21, screen.status);
    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 31, screen.transport);
    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 41, screen.key);
    mono_framebuffer_draw_text(framebuffer, HOST_OLED_WIDTH, HOST_OLED_HEIGHT, 3, 51, screen.output);

    return host_oled_write_frame(&oled, framebuffer, sizeof(framebuffer));
}

static esp_err_t test_host_oled(const char **detail)
{
    oled_probe_result_t oled = get_known_oled_output();
    if (!oled.detected) {
        *detail = "No OLED detected on common I2C pin pairs.";
        return ESP_ERR_NOT_FOUND;
    }
    uint8_t framebuffer[OLED_FRAMEBUFFER_SIZE];
    for (size_t index = 0; index < sizeof(framebuffer); index++) {
        framebuffer[index] = ((index / 16) % 2 == 0) ? 0xFF : 0x00;
    }

    esp_err_t result = host_oled_write_frame(&oled, framebuffer, sizeof(framebuffer));
    *detail = result == ESP_OK
        ? "SSD1306-compatible OLED initialized and loaded with a stripe test pattern."
        : "SSD1306-compatible OLED test failed during I2C init or framebuffer write.";
    return result;
}
#endif

static void show_attached_status_outputs(const identity_record_t *identity, bool storage_ok)
{
#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
    esp_err_t result = render_tdongle_status_screen(identity, storage_ok);
    if (result != ESP_OK) {
        ESP_LOGW(TAG, "Status screen render failed on tdongle display: %s", esp_err_to_name(result));
    }
#elif defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
    esp_err_t result = render_host_ili9341_status_screen(identity, storage_ok);
    if (result == ESP_ERR_NOT_FOUND) {
        result = render_host_oled_status_screen(identity, storage_ok);
    }
    if (result != ESP_OK && result != ESP_ERR_NOT_FOUND) {
        ESP_LOGW(TAG, "Status screen render failed on host display/OLED: %s", esp_err_to_name(result));
    }
#endif
}

static void restore_status_outputs_after_test(void)
{
    identity_record_t identity = {0};
    esp_err_t storage_status = load_identity(&identity);
    if (storage_status != ESP_OK) {
        memset(&identity, 0, sizeof(identity));
    }

    vTaskDelay(pdMS_TO_TICKS(TEST_OUTPUT_STATUS_RESTORE_DELAY_MS));
    show_attached_status_outputs(&identity, storage_status == ESP_OK);
}

static void send_platform_io_response(int request_id)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "device", BOARD.device);
    cJSON_AddStringToObject(root, "chip", BOARD.chip);
    cJSON_AddStringToObject(root, "profile", BOARD.profile);
    cJSON_AddStringToObject(root, "transport", BOARD.transport);

    cJSON *outputs = cJSON_AddArrayToObject(root, "outputs");
    cJSON *gpio = cJSON_AddObjectToObject(root, "gpio");
    cJSON *hardware_profile = cJSON_AddObjectToObject(root, "hardwareProfile");
    if (outputs == NULL || gpio == NULL || hardware_profile == NULL) {
        cJSON_Delete(root);
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    cJSON_AddNumberToObject(gpio, "pinCount", BOARD.gpio_pin_count);
    cJSON_AddStringToObject(gpio, "inputRange", BOARD.gpio_input_range);
    cJSON_AddStringToObject(gpio, "outputRange", BOARD.gpio_output_range);
    cJSON_AddBoolToObject(gpio, "liveProbeSupported", false);
    cJSON_AddStringToObject(gpio, "probeStatus", "device-info-only");
    cJSON_AddStringToObject(gpio, "attachmentStatus", "live-gpio-attachment-probe-not-implemented");

    cJSON_AddNumberToObject(hardware_profile, "schemaVersion", 1);
    cJSON_AddStringToObject(hardware_profile, "nodeClass", BOARD.profile);
    cJSON_AddStringToObject(hardware_profile, "transport", BOARD.transport);
    cJSON *profile_gpio = cJSON_AddObjectToObject(hardware_profile, "gpio");
    cJSON *profile_buses = cJSON_AddArrayToObject(hardware_profile, "buses");
    cJSON *profile_outputs = cJSON_AddArrayToObject(hardware_profile, "outputs");
    cJSON *profile_capabilities = cJSON_AddArrayToObject(hardware_profile, "capabilities");
    cJSON *profile_learned = cJSON_AddObjectToObject(hardware_profile, "learnedConfig");
    if (profile_gpio != NULL) {
        cJSON_AddNumberToObject(profile_gpio, "pinCount", BOARD.gpio_pin_count);
        cJSON_AddStringToObject(profile_gpio, "inputRange", BOARD.gpio_input_range);
        cJSON_AddStringToObject(profile_gpio, "outputRange", BOARD.gpio_output_range);
        cJSON_AddBoolToObject(profile_gpio, "liveProbeSupported", false);
    }

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
    cJSON *display = cJSON_CreateObject();
    cJSON *rgb_led = cJSON_CreateObject();
    if (display != NULL && rgb_led != NULL) {
        cJSON_AddStringToObject(display, "kind", "display");
        cJSON_AddStringToObject(display, "driver", "st7735");
        cJSON_AddStringToObject(display, "resolution", "80x160");
        cJSON_AddStringToObject(display, "status", "declared-on-board");
        cJSON_AddStringToObject(display, "detection", "board-profile");
        cJSON_AddStringToObject(display, "confidence", "declared");
        cJSON_AddBoolToObject(display, "learned", false);
        cJSON_AddItemToArray(outputs, display);

        cJSON_AddStringToObject(rgb_led, "kind", "rgb-led");
        cJSON_AddStringToObject(rgb_led, "status", "declared-on-board");
        cJSON_AddStringToObject(rgb_led, "detection", "board-profile");
        cJSON_AddStringToObject(rgb_led, "confidence", "declared");
        cJSON_AddBoolToObject(rgb_led, "learned", false);
        cJSON_AddItemToArray(outputs, rgb_led);
    } else {
        cJSON_Delete(display);
        cJSON_Delete(rgb_led);
    }
    if (profile_buses != NULL) {
        cJSON *spi_bus = cJSON_CreateObject();
        cJSON *usb_bus = cJSON_CreateObject();
        if (spi_bus != NULL) {
            cJSON_AddStringToObject(spi_bus, "kind", "spi");
            cJSON_AddStringToObject(spi_bus, "status", "declared");
            cJSON_AddStringToObject(spi_bus, "purpose", "display");
            cJSON_AddItemToArray(profile_buses, spi_bus);
        }
        if (usb_bus != NULL) {
            cJSON_AddStringToObject(usb_bus, "kind", "usb-serial-jtag");
            cJSON_AddStringToObject(usb_bus, "status", "declared");
            cJSON_AddStringToObject(usb_bus, "purpose", "transport");
            cJSON_AddItemToArray(profile_buses, usb_bus);
        }
    }
    if (profile_capabilities != NULL) {
        cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("display"));
        cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("rgb-led"));
        cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("identity-holder"));
    }
    if (profile_outputs != NULL) {
        cJSON_AddItemToArray(profile_outputs, cJSON_Duplicate(outputs->child, true));
        if (outputs->child != NULL && outputs->child->next != NULL) {
            cJSON_AddItemToArray(profile_outputs, cJSON_Duplicate(outputs->child->next, true));
        }
    }
#elif defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
    tft_probe_result_t tft = get_known_ili9341_output();
    bool tft_learned = s_cached_blind_tft_persisted &&
        s_cached_blind_tft.detected &&
        s_cached_blind_tft.tft.cs == tft.cs &&
        s_cached_blind_tft.tft.dc == tft.dc &&
        s_cached_blind_tft.tft.sclk == tft.sclk &&
        s_cached_blind_tft.tft.mosi == tft.mosi;
    cJSON *tft_display = cJSON_CreateObject();
    oled_probe_result_t oled = probe_common_oled_outputs();
    cJSON *oled_display = cJSON_CreateObject();
    if (tft_display != NULL) {
        cJSON_AddStringToObject(tft_display, "kind", "display");
        cJSON_AddStringToObject(tft_display, "driverFamily", "ili9341-compatible");
        if (tft.detected) {
            char signature_text[16];
            snprintf(signature_text, sizeof(signature_text), "%02X-%02X-%02X-%02X", tft.signature[0], tft.signature[1], tft.signature[2], tft.signature[3]);
            cJSON_AddStringToObject(tft_display, "status", "detected");
            cJSON_AddStringToObject(tft_display, "detection", tft_learned ? "learned-blind-spi-preset" : "common-spi-probe");
            cJSON_AddStringToObject(tft_display, "confidence", tft_learned ? "blind-confirmed" : "confirmed");
            cJSON_AddBoolToObject(tft_display, "learned", tft_learned);
            cJSON_AddStringToObject(tft_display, "signature", signature_text);
            cJSON_AddStringToObject(tft_display, "resolution", "240x320");
            cJSON_AddNumberToObject(tft_display, "mosi", tft.mosi);
            cJSON_AddNumberToObject(tft_display, "miso", tft.miso);
            cJSON_AddNumberToObject(tft_display, "sclk", tft.sclk);
            cJSON_AddNumberToObject(tft_display, "cs", tft.cs);
            cJSON_AddNumberToObject(tft_display, "dc", tft.dc);
            if (tft.rst >= 0) {
                cJSON_AddNumberToObject(tft_display, "rst", tft.rst);
            }
            if (tft.bl >= 0) {
                cJSON_AddNumberToObject(tft_display, "backlight", tft.bl);
            }
            if (tft_learned && s_cached_blind_tft.candidate_index >= 0) {
                cJSON_AddNumberToObject(tft_display, "preset", s_cached_blind_tft.candidate_index + 1);
            }
        } else {
            cJSON_AddStringToObject(tft_display, "status", "not-detected");
            cJSON_AddStringToObject(tft_display, "detection", "common-spi-probe");
            cJSON_AddStringToObject(tft_display, "confidence", "none");
            cJSON_AddBoolToObject(tft_display, "learned", false);
            cJSON_AddStringToObject(tft_display, "note", "No ILI9341 found on common ESP32 SPI pin presets");
        }
        cJSON_AddItemToArray(outputs, tft_display);
    } else {
        cJSON_Delete(tft_display);
    }
    if (oled_display != NULL) {
        cJSON_AddStringToObject(oled_display, "kind", "oled");
        cJSON_AddStringToObject(oled_display, "driverFamily", "ssd1306-compatible");
        if (oled.detected) {
            char address_text[8];
            snprintf(address_text, sizeof(address_text), "0x%02X", oled.address);
            cJSON_AddStringToObject(oled_display, "status", "detected");
            cJSON_AddStringToObject(oled_display, "detection", "common-i2c-probe");
            cJSON_AddStringToObject(oled_display, "confidence", "confirmed");
            cJSON_AddBoolToObject(oled_display, "learned", false);
            cJSON_AddStringToObject(oled_display, "i2cAddress", address_text);
            cJSON_AddNumberToObject(oled_display, "sda", oled.sda);
            cJSON_AddNumberToObject(oled_display, "scl", oled.scl);
        } else {
            cJSON_AddStringToObject(oled_display, "status", "not-detected");
            cJSON_AddStringToObject(oled_display, "detection", "common-i2c-probe");
            cJSON_AddStringToObject(oled_display, "confidence", "none");
            cJSON_AddBoolToObject(oled_display, "learned", false);
            cJSON_AddStringToObject(oled_display, "note", "No OLED found on common I2C pin pairs and addresses");
        }
        cJSON_AddItemToArray(outputs, oled_display);
    } else {
        cJSON_Delete(oled_display);
    }
    if (profile_buses != NULL) {
        cJSON *uart_bus = cJSON_CreateObject();
        cJSON *spi_bus = cJSON_CreateObject();
        cJSON *i2c_bus = cJSON_CreateObject();
        if (uart_bus != NULL) {
            cJSON_AddStringToObject(uart_bus, "kind", "uart0");
            cJSON_AddStringToObject(uart_bus, "status", "declared");
            cJSON_AddStringToObject(uart_bus, "purpose", "transport");
            cJSON_AddItemToArray(profile_buses, uart_bus);
        }
        if (spi_bus != NULL) {
            cJSON_AddStringToObject(spi_bus, "kind", "spi");
            cJSON_AddStringToObject(spi_bus, "status", tft.detected ? "probed" : "scanned");
            cJSON_AddStringToObject(spi_bus, "purpose", "display-probe");
            cJSON_AddStringToObject(spi_bus, "confidence", tft.detected ? (tft_learned ? "blind-confirmed" : "confirmed") : "none");
            cJSON_AddItemToArray(profile_buses, spi_bus);
        }
        if (i2c_bus != NULL) {
            cJSON_AddStringToObject(i2c_bus, "kind", "i2c");
            cJSON_AddStringToObject(i2c_bus, "status", oled.detected ? "probed" : "scanned");
            cJSON_AddStringToObject(i2c_bus, "purpose", "display-probe");
            cJSON_AddStringToObject(i2c_bus, "confidence", oled.detected ? "confirmed" : "none");
            cJSON_AddItemToArray(profile_buses, i2c_bus);
        }
    }
    if (profile_capabilities != NULL) {
        if (tft.detected) {
            cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("display"));
        }
        if (oled.detected) {
            cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("display"));
        }
        cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("identity-holder"));
        cJSON_AddItemToArray(profile_capabilities, cJSON_CreateString("host-attached"));
    }
    if (profile_outputs != NULL) {
        for (cJSON *output = outputs->child; output != NULL; output = output->next) {
            cJSON_AddItemToArray(profile_outputs, cJSON_Duplicate(output, true));
        }
    }
    if (profile_learned != NULL) {
        cJSON_AddBoolToObject(profile_learned, "hasLearnedDisplayPreset", s_cached_blind_tft_persisted && s_cached_blind_tft.detected);
        if (s_cached_blind_tft_persisted && s_cached_blind_tft.detected) {
            cJSON_AddNumberToObject(profile_learned, "displayPreset", s_cached_blind_tft.candidate_index + 1);
            cJSON_AddStringToObject(profile_learned, "displayConfidence", "blind-confirmed");
        }
    }
#endif

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send platform IO response");
    }
    cJSON_Delete(root);
}

static bool target_matches(const char *requested_target, const char *expected_target)
{
    if (requested_target == NULL || requested_target[0] == '\0') {
        return true;
    }
    if (strcmp(requested_target, "all") == 0) {
        return true;
    }
    return strcmp(requested_target, expected_target) == 0;
}

static void send_test_output_response(int request_id, cJSON *request)
{
    const char *requested_target = "all";
    cJSON *target_item = cJSON_GetObjectItemCaseSensitive(request, "target");
    if (cJSON_IsString(target_item) && target_item->valuestring != NULL && target_item->valuestring[0] != '\0') {
        requested_target = target_item->valuestring;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "device", BOARD.device);
    cJSON_AddStringToObject(root, "chip", BOARD.chip);
    cJSON_AddStringToObject(root, "profile", BOARD.profile);
    cJSON_AddStringToObject(root, "transport", BOARD.transport);
    cJSON_AddStringToObject(root, "target", requested_target);

    cJSON *results = cJSON_AddArrayToObject(root, "results");
    if (results == NULL) {
        cJSON_Delete(root);
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
    if (target_matches(requested_target, "display")) {
        const char *detail = NULL;
        esp_err_t result = test_tdongle_display(&detail);
        append_test_result(results, "display", result == ESP_OK ? "ok" : "error", detail);
    }
    if (target_matches(requested_target, "rgb-led")) {
        const char *detail = NULL;
        esp_err_t result = test_tdongle_rgb_led(&detail);
        append_test_result(results, "rgb-led", result == ESP_OK ? "ok" : "error", detail);
    }
    if (target_matches(requested_target, "oled")) {
        append_test_result(results, "oled", "skipped", "OLED output is not part of the tdongle-s3 board profile.");
    }
#elif defined(ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32)
    if (target_matches(requested_target, "display")) {
        const char *detail = NULL;
        esp_err_t result = test_host_ili9341(&detail);
        append_test_result(
            results,
            "display",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "display-status")) {
        const char *detail = NULL;
        esp_err_t result = render_host_ili9341_status_preview(&detail);
        append_test_result(
            results,
            "display-status",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "display-sweep")) {
        const char *detail = NULL;
        esp_err_t result = preview_host_ili9341_sweep(&detail);
        append_test_result(
            results,
            "display-sweep",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "display-save")) {
        const char *detail = NULL;
        esp_err_t result = persist_current_blind_tft(&detail);
        append_test_result(
            results,
            "display-save",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "display-clear-learned")) {
        const char *detail = NULL;
        esp_err_t result = reset_current_blind_tft(&detail);
        append_test_result(
            results,
            "display-clear-learned",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "oled")) {
        const char *detail = NULL;
        esp_err_t result = test_host_oled(&detail);
        append_test_result(
            results,
            "oled",
            result == ESP_OK ? "ok" : (result == ESP_ERR_NOT_FOUND ? "skipped" : "error"),
            detail);
    }
    if (target_matches(requested_target, "rgb-led")) {
        append_test_result(results, "rgb-led", "skipped", "RGB LED output is not part of the host-identity-esp32 board profile.");
    }
#endif

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send test output response");
    }
    cJSON_Delete(root);
    restore_status_outputs_after_test();
}

static esp_err_t init_rng(mbedtls_entropy_context *entropy, mbedtls_ctr_drbg_context *ctr_drbg)
{
    int result = 0;

    mbedtls_entropy_init(entropy);
    mbedtls_ctr_drbg_init(ctr_drbg);

    result = mbedtls_ctr_drbg_seed(
        ctr_drbg,
        mbedtls_entropy_func,
        entropy,
        (const unsigned char *) BOARD.personalization,
        strlen(BOARD.personalization));
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
    mbedtls_sha256(identity->public_key, sizeof(identity->public_key), digest, 0);

    esp_err_t result = hex_encode_alloc(digest, sizeof(digest), fingerprint);
    if (result != ESP_OK) {
        return result;
    }

    const size_t short_length = 16;
    *key_id = calloc(1, strlen("p256:") + short_length + 1);
    if (*key_id == NULL) {
        free(*fingerprint);
        *fingerprint = NULL;
        return ESP_ERR_NO_MEM;
    }

    snprintf(*key_id, strlen("p256:") + short_length + 1, "p256:%.16s", *fingerprint);
    return ESP_OK;
}

static esp_err_t load_identity(identity_record_t *identity)
{
    nvs_handle_t nvs = 0;
    esp_err_t result = nvs_open(IDENTITY_NAMESPACE, NVS_READONLY, &nvs);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        identity->present = false;
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(result, TAG, "Failed to open identity namespace");

    size_t private_key_length = sizeof(identity->private_key);
    size_t public_key_length = sizeof(identity->public_key);

    result = nvs_get_blob(nvs, IDENTITY_PRIVATE_KEY, identity->private_key, &private_key_length);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        identity->present = false;
        nvs_close(nvs);
        return ESP_OK;
    }
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read private key: %s", esp_err_to_name(result));
        goto cleanup;
    }

    result = nvs_get_blob(nvs, IDENTITY_PUBLIC_KEY, identity->public_key, &public_key_length);
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read public key: %s", esp_err_to_name(result));
        goto cleanup;
    }

    if (private_key_length != sizeof(identity->private_key) || public_key_length != sizeof(identity->public_key)) {
        result = ESP_FAIL;
        ESP_LOGE(TAG, "Unexpected key sizes in storage");
        goto cleanup;
    }

    identity->present = true;

cleanup:
    nvs_close(nvs);
    return result;
}

static esp_err_t save_identity(const identity_record_t *identity)
{
    nvs_handle_t nvs = 0;
    esp_err_t result = nvs_open(IDENTITY_NAMESPACE, NVS_READWRITE, &nvs);
    ESP_RETURN_ON_ERROR(result, TAG, "Failed to open identity namespace");

    result = nvs_set_blob(nvs, IDENTITY_PRIVATE_KEY, identity->private_key, sizeof(identity->private_key));
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Failed to write private key: %s", esp_err_to_name(result));
        goto cleanup;
    }

    result = nvs_set_blob(nvs, IDENTITY_PUBLIC_KEY, identity->public_key, sizeof(identity->public_key));
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Failed to write public key: %s", esp_err_to_name(result));
        goto cleanup;
    }

    result = nvs_commit(nvs);
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Failed to commit identity: %s", esp_err_to_name(result));
        goto cleanup;
    }

cleanup:
    nvs_close(nvs);
    return result;
}

static esp_err_t generate_identity(identity_record_t *identity)
{
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;
    int result = 0;
    esp_err_t status = init_rng(&entropy, &ctr_drbg);
    if (status != ESP_OK) {
        return status;
    }

    mbedtls_ecdsa_init(&ecdsa);
    result = mbedtls_ecdsa_genkey(&ecdsa, MBEDTLS_ECP_DP_SECP256R1, mbedtls_ctr_drbg_random, &ctr_drbg);
    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_ecdsa_genkey failed: -0x%04x", -result);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        return ESP_FAIL;
    }

    memset(identity, 0, sizeof(*identity));
    result = mbedtls_mpi_write_binary(&ecdsa.MBEDTLS_PRIVATE(d), identity->private_key, sizeof(identity->private_key));
    if (result != 0) {
        ESP_LOGE(TAG, "mbedtls_mpi_write_binary private failed: -0x%04x", -result);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        return ESP_FAIL;
    }

    size_t public_key_length = 0;
    result = mbedtls_ecp_point_write_binary(
        &ecdsa.MBEDTLS_PRIVATE(grp),
        &ecdsa.MBEDTLS_PRIVATE(Q),
        MBEDTLS_ECP_PF_UNCOMPRESSED,
        &public_key_length,
        identity->public_key,
        sizeof(identity->public_key));
    if (result != 0 || public_key_length != sizeof(identity->public_key)) {
        ESP_LOGE(TAG, "Failed to export public key: -0x%04x", -result);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        return ESP_FAIL;
    }

    identity->present = true;
    mbedtls_ecdsa_free(&ecdsa);
    free_rng(&entropy, &ctr_drbg);
    return save_identity(identity);
}

static void send_identity_response(int request_id, const identity_record_t *identity, bool created)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    char *public_key_base64 = NULL;
    char *fingerprint_hex = NULL;
    char *key_id = NULL;

    if (base64_encode_alloc(identity->public_key, sizeof(identity->public_key), &public_key_base64) != ESP_OK ||
        build_identity_labels(identity, &fingerprint_hex, &key_id) != ESP_OK) {
        free(public_key_base64);
        free(fingerprint_hex);
        free(key_id);
        cJSON_Delete(root);
        send_error_response(request_id, "internal_error", "Failed to encode identity");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(root, "curve", "P-256");
    cJSON_AddStringToObject(root, "publicKeyBase64", public_key_base64);
    cJSON_AddStringToObject(root, "fingerprintHex", fingerprint_hex);
    cJSON_AddStringToObject(root, "keyId", key_id);
    if (created) {
        cJSON_AddBoolToObject(root, "created", true);
    }

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send identity response");
    }

    free(public_key_base64);
    free(fingerprint_hex);
    free(key_id);
    cJSON_Delete(root);
}

static void send_public_id_response(int request_id)
{
    identity_record_t identity = {0};
    esp_err_t result = load_identity(&identity);
    if (result != ESP_OK) {
        send_error_response(request_id, "storage_error", "Could not load identity");
        return;
    }

    if (!identity.present) {
        send_error_response(request_id, "identity_missing", "Identity not generated");
        return;
    }

    send_identity_response(request_id, &identity, false);
}

static void send_gen_identity_response(int request_id)
{
    identity_record_t identity = {0};
    esp_err_t result = load_identity(&identity);
    if (result != ESP_OK) {
        send_error_response(request_id, "storage_error", "Could not inspect identity");
        return;
    }

    if (!identity.present) {
        result = generate_identity(&identity);
        if (result != ESP_OK) {
            send_error_response(request_id, "crypto_error", "Failed to generate identity");
            return;
        }
    }

    send_identity_response(request_id, &identity, true);
    show_attached_status_outputs(&identity, true);
}

static void send_sign_response(int request_id, const identity_record_t *identity, const uint8_t *signature, size_t signature_length)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        send_error_response(request_id, "internal_error", "Out of memory");
        return;
    }

    char *public_key_base64 = NULL;
    char *fingerprint_hex = NULL;
    char *key_id = NULL;
    char *signature_base64 = NULL;

    if (base64_encode_alloc(identity->public_key, sizeof(identity->public_key), &public_key_base64) != ESP_OK ||
        build_identity_labels(identity, &fingerprint_hex, &key_id) != ESP_OK ||
        base64_encode_alloc(signature, signature_length, &signature_base64) != ESP_OK) {
        free(public_key_base64);
        free(fingerprint_hex);
        free(key_id);
        free(signature_base64);
        cJSON_Delete(root);
        send_error_response(request_id, "internal_error", "Failed to encode signature response");
        return;
    }

    cJSON_AddNumberToObject(root, "id", request_id);
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "algorithm", "ES256");
    cJSON_AddStringToObject(root, "curve", "P-256");
    cJSON_AddStringToObject(root, "publicKeyBase64", public_key_base64);
    cJSON_AddStringToObject(root, "fingerprintHex", fingerprint_hex);
    cJSON_AddStringToObject(root, "keyId", key_id);
    cJSON_AddStringToObject(root, "signatureBase64", signature_base64);

    if (send_json(root) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to send sign response");
    }

    free(public_key_base64);
    free(fingerprint_hex);
    free(key_id);
    free(signature_base64);
    cJSON_Delete(root);
}

static void send_sign_bytes_response(int request_id, cJSON *request)
{
    identity_record_t identity = {0};
    esp_err_t status = load_identity(&identity);
    if (status != ESP_OK) {
        send_error_response(request_id, "storage_error", "Could not load identity");
        return;
    }
    if (!identity.present) {
        send_error_response(request_id, "identity_missing", "Identity not generated");
        return;
    }

    cJSON *payload_item = cJSON_GetObjectItemCaseSensitive(request, "payloadBase64");
    if (!cJSON_IsString(payload_item) || payload_item->valuestring == NULL) {
        send_error_response(request_id, "invalid_request", "Missing payloadBase64");
        return;
    }

    uint8_t *payload = NULL;
    size_t payload_length = 0;
    if (base64_decode_alloc(payload_item->valuestring, &payload, &payload_length) != ESP_OK) {
        send_error_response(request_id, "invalid_request", "Could not decode payloadBase64");
        return;
    }

    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;
    int result = 0;
    uint8_t digest[SHA256_SIZE];
    uint8_t signature[SIGNATURE_BUFFER_SIZE];
    size_t signature_length = 0;

    if (init_rng(&entropy, &ctr_drbg) != ESP_OK) {
        free(payload);
        send_error_response(request_id, "crypto_error", "Failed to initialize RNG");
        return;
    }

    mbedtls_ecdsa_init(&ecdsa);
    result = mbedtls_ecp_group_load(&ecdsa.MBEDTLS_PRIVATE(grp), MBEDTLS_ECP_DP_SECP256R1);
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
        ESP_LOGE(TAG, "Failed to restore ECDSA key: -0x%04x", -result);
        free(payload);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        send_error_response(request_id, "crypto_error", "Failed to restore identity key");
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
    identity_record_t identity = {0};
    esp_err_t status = load_identity(&identity);
    if (status != ESP_OK) {
        send_error_response(request_id, "storage_error", "Could not load identity");
        return;
    }
    if (!identity.present) {
        send_error_response(request_id, "identity_missing", "Identity not generated");
        return;
    }

    cJSON *digest_item = cJSON_GetObjectItemCaseSensitive(request, "digestBase64");
    if (!cJSON_IsString(digest_item) || digest_item->valuestring == NULL) {
        send_error_response(request_id, "invalid_request", "Missing digestBase64");
        return;
    }

    uint8_t *digest = NULL;
    size_t digest_length = 0;
    if (base64_decode_alloc(digest_item->valuestring, &digest, &digest_length) != ESP_OK) {
        send_error_response(request_id, "invalid_request", "Could not decode digestBase64");
        return;
    }

    if (digest_length != SHA256_SIZE) {
        free(digest);
        send_error_response(request_id, "invalid_request", "digestBase64 must decode to 32 bytes");
        return;
    }

    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ecdsa_context ecdsa;
    int result = 0;
    uint8_t signature[SIGNATURE_BUFFER_SIZE];
    size_t signature_length = 0;

    if (init_rng(&entropy, &ctr_drbg) != ESP_OK) {
        free(digest);
        send_error_response(request_id, "crypto_error", "Failed to initialize RNG");
        return;
    }

    mbedtls_ecdsa_init(&ecdsa);
    result = mbedtls_ecp_group_load(&ecdsa.MBEDTLS_PRIVATE(grp), MBEDTLS_ECP_DP_SECP256R1);
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
        ESP_LOGE(TAG, "Failed to restore ECDSA key: -0x%04x", -result);
        free(digest);
        mbedtls_ecdsa_free(&ecdsa);
        free_rng(&entropy, &ctr_drbg);
        send_error_response(request_id, "crypto_error", "Failed to restore identity key");
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
    } else if (strcmp(cmd_item->valuestring, CMD_GET_PLATFORM_IO) == 0) {
        send_platform_io_response(request_id);
    } else if (strcmp(cmd_item->valuestring, CMD_TEST_OUTPUT) == 0) {
        send_test_output_response(request_id, request);
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
#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
    usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    config.rx_buffer_size = 1024;
    config.tx_buffer_size = 1024;
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));
#else
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
#endif
}

static void init_storage(void)
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(result);
}

void app_main(void)
{
    TAG = BOARD.log_tag;
    init_storage();
    init_console_transport();

    ESP_LOGI(TAG, "ESP messenger unified node starting for board profile %s", ESP_MESSENGER_BOARD_PROFILE_NAME);

    identity_record_t startup_identity = {0};
    esp_err_t startup_identity_status = load_identity(&startup_identity);
    if (startup_identity_status != ESP_OK) {
        memset(&startup_identity, 0, sizeof(startup_identity));
    }
    show_attached_status_outputs(&startup_identity, startup_identity_status == ESP_OK);

    size_t line_length = 0;
    while (true) {
#if defined(ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3)
        int bytes_read = usb_serial_jtag_read_bytes(s_rx_buffer, sizeof(s_rx_buffer), pdMS_TO_TICKS(20));
#else
        int bytes_read = uart_read_bytes(CONSOLE_UART, s_rx_buffer, sizeof(s_rx_buffer), pdMS_TO_TICKS(20));
#endif
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
                if (line_length > 0) {
                    handle_command_line(s_line_buffer);
                }
                line_length = 0;
                continue;
            }

            if (!isprint((unsigned char) current) && current != '\t') {
                continue;
            }

            if (line_length + 1 >= sizeof(s_line_buffer)) {
                line_length = 0;
                send_error_response(0, "line_too_long", "Input line exceeded buffer");
                continue;
            }

            s_line_buffer[line_length++] = current;
        }
    }
}
