#include "zeq_sha256.h"
#include <stdio.h>
#include <string.h>

static int check(const char *text, const char *expected)
{
    static const char digits[] = "0123456789abcdef";
    zeq_sha256_t context;
    uint8_t digest[32];
    char actual[65];
    size_t i;
    ZEQ_SHA256_Init(&context);
    ZEQ_SHA256_Update(&context, text, strlen(text) / 2);
    ZEQ_SHA256_Update(&context, text + strlen(text) / 2, strlen(text) - strlen(text) / 2);
    ZEQ_SHA256_Final(&context, digest);
    for (i = 0; i < 32; i++)
    {
        actual[i * 2] = digits[digest[i] >> 4];
        actual[i * 2 + 1] = digits[digest[i] & 15];
    }
    actual[64] = 0;
    if (strcmp(actual, expected) != 0)
    {
        fprintf(stderr, "SHA-256 mismatch: %s != %s\n", actual, expected);
        return 0;
    }
    return 1;
}

int main(void)
{
    if (!check("", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")) return 1;
    if (!check("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")) return 1;
    if (!check("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")) return 1;
    puts("C SHA-256 OK: empty, abc, two-block FIPS vectors");
    return 0;
}
