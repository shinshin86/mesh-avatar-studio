#include "mesh_avatar.h"
#include <math.h>
#include <stdio.h>

#define CHECK(call) do { \
    MaStatus status = (call); \
    if (status != MA_OK) { \
        fprintf(stderr, "%s failed (%d): %s\n", #call, (int)status, mesh_avatar_last_error()); \
        goto failed; \
    } \
} while (0)

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "../samples/miko-qipao";
    MaHandle avatar = 0;
    printf("Mesh Avatar %s, ABI %u\n", mesh_avatar_version(), mesh_avatar_abi_version());
    CHECK(mesh_avatar_open_path(path, &avatar));
    CHECK(mesh_avatar_set_auto_idle(avatar, 0));
    CHECK(mesh_avatar_set_auto_motion(avatar, 0));
    MaParameter pose[] = {{"angleX", 15.0}, {"mouthOpen", 0.4}};
    CHECK(mesh_avatar_set_parameters(avatar, pose, 2, 1.0));
    CHECK(mesh_avatar_set_expression(avatar, "smile"));
    /* Optional accessories start hidden. Names absent from this avatar are ignored. */
    const char *overlays[] = {"glasses"};
    CHECK(mesh_avatar_set_overlays(avatar, overlays, 1));
    CHECK(mesh_avatar_play(avatar, "nod"));
    for (int i = 0; i < 60; ++i) CHECK(mesh_avatar_tick(avatar, 1.0 / 60.0));

    MaAvatarInfo info;
    size_t texture_count;
    CHECK(mesh_avatar_get_info(avatar, &info));
    CHECK(mesh_avatar_texture_count(avatar, &texture_count));
    if (!info.image_width || !info.image_height || !texture_count) goto invalid;
    for (size_t i = 0; i < texture_count; ++i) {
        MaTexture texture;
        CHECK(mesh_avatar_get_texture(avatar, i, &texture));
        if (texture.id != i || !texture.name || !texture.rgba ||
            texture.byte_count != (size_t)texture.width * texture.height * 4) goto invalid;
    }

    MaFrame frame;
    CHECK(mesh_avatar_get_frame(avatar, &frame));
    if (!frame.layer_count || !frame.layers) goto invalid;
    size_t vertices = 0, indices = 0;
    /* Borrowed arrays: read before calling tick/destroy, including on other threads. */
    for (size_t i = 0; i < frame.layer_count; ++i) {
        const MaLayer *layer = &frame.layers[i];
        if (!layer->name || layer->texture_id >= texture_count || !isfinite(layer->alpha)) goto invalid;
        if (layer->vertex_count && (!layer->positions || !layer->uvs)) goto invalid;
        if (layer->index_count && !layer->indices) goto invalid;
        for (size_t j = 0; j < layer->vertex_count * 2; ++j)
            if (!isfinite(layer->positions[j]) || !isfinite(layer->uvs[j])) goto invalid;
        for (size_t j = 0; j < layer->index_count; ++j)
            if (layer->indices[j] >= layer->vertex_count) goto invalid;
        vertices += layer->vertex_count;
        indices += layer->index_count;
    }
    if (!isfinite(frame.uniforms.angles[0]) || !isfinite(frame.uniforms.mouth_state[0])) goto invalid;
    printf("%ux%u: %zu textures, %zu layers, %zu vertices, %zu indices\n",
           info.image_width, info.image_height, texture_count, frame.layer_count, vertices, indices);
    if (mesh_avatar_get_frame(avatar, NULL) != MA_INVALID_ARGUMENT) goto invalid;
    CHECK(mesh_avatar_set_overlays(avatar, NULL, 0));
    CHECK(mesh_avatar_destroy(avatar));
    if (mesh_avatar_tick(avatar, 0.0) != MA_INVALID_HANDLE) goto invalid;
    puts("C ABI checks passed");
    return 0;
invalid:
    fputs("Invalid C ABI data or error behavior\n", stderr);
failed:
    if (avatar) (void)mesh_avatar_destroy(avatar);
    return 1;
}
