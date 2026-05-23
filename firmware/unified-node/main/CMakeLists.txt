set(unified_requires json mbedtls nvs_flash driver esp_driver_gpio esp_driver_spi esp_driver_ledc)

if(IDF_TARGET STREQUAL "esp32s3")
    list(APPEND unified_requires esp_driver_usb_serial_jtag)
elseif(IDF_TARGET STREQUAL "esp32")
    list(APPEND unified_requires driver)
else()
    message(FATAL_ERROR "Unified node currently supports only esp32s3 and esp32 targets.")
endif()

if(DEFINED ENV{ESP_MESSENGER_BOARD_PROFILE} AND NOT "$ENV{ESP_MESSENGER_BOARD_PROFILE}" STREQUAL "")
    set(ESP_MESSENGER_BOARD_PROFILE "$ENV{ESP_MESSENGER_BOARD_PROFILE}")
elseif(NOT DEFINED ESP_MESSENGER_BOARD_PROFILE)
    set(ESP_MESSENGER_BOARD_PROFILE "tdongle-s3")
endif()

if(ESP_MESSENGER_BOARD_PROFILE STREQUAL "tdongle-s3")
    if(NOT IDF_TARGET STREQUAL "esp32s3")
        message(FATAL_ERROR "Board profile tdongle-s3 requires IDF_TARGET=esp32s3.")
    endif()
    set(unified_compile_definitions
        ESP_MESSENGER_BOARD_PROFILE_TDONGLE_S3=1
        ESP_MESSENGER_BOARD_PROFILE_NAME=\"tdongle-s3\"
    )
elseif(ESP_MESSENGER_BOARD_PROFILE STREQUAL "host-identity-esp32")
    if(NOT IDF_TARGET STREQUAL "esp32")
        message(FATAL_ERROR "Board profile host-identity-esp32 requires IDF_TARGET=esp32.")
    endif()
    set(unified_compile_definitions
        ESP_MESSENGER_BOARD_PROFILE_HOST_IDENTITY_ESP32=1
        ESP_MESSENGER_BOARD_PROFILE_NAME=\"host-identity-esp32\"
    )
else()
    message(FATAL_ERROR "Unsupported ESP_MESSENGER_BOARD_PROFILE=${ESP_MESSENGER_BOARD_PROFILE}")
endif()

idf_component_register(
    SRCS "unified_node_main.c"
    INCLUDE_DIRS "." "../../shared/include"
    REQUIRES ${unified_requires}
)

target_compile_definitions(${COMPONENT_LIB} PRIVATE ${unified_compile_definitions})
