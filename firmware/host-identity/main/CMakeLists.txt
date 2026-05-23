idf_component_register(
    SRCS "host_identity_main.c"
    INCLUDE_DIRS "." "../../shared/include"
    REQUIRES driver json mbedtls nvs_flash
)
