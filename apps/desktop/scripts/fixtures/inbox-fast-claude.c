#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    const char *id = "fixture";
    for (int i = 1; i + 1 < argc; i++) {
        if (!strcmp(argv[i], "--resume") || !strcmp(argv[i], "--session-id")) {
            id = argv[i + 1];
        }
    }
    char *line = NULL;
    size_t size = 0;
    while (getline(&line, &size, stdin) > 0) {
        if (!strstr(line, "\"type\":\"user\"")) continue;
        printf("{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"%s\","
               "\"is_error\":false,\"result\":\"done\",\"duration_ms\":1,\"total_cost_usd\":0,"
               "\"modelUsage\":{},\"usage\":{\"input_tokens\":0,\"output_tokens\":0,"
               "\"cache_read_input_tokens\":0,\"cache_creation_input_tokens\":0}}\n", id);
        fflush(stdout);
    }
    free(line);
    return 0;
}
