idf_component_register(
    SRCS "dongle_main.c"
    INCLUDE_DIRS "." "../../shared/include"
    REQUIRES esp_driver_usb_serial_jtag json mbedtls nvs_flash
)
