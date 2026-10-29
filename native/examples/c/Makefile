CC ?= cc
NATIVE := ../..
OUT := $(NATIVE)/target/ffi-example
RENDER_OUT := $(NATIVE)/target/ffi-render-example
TERMINAL_OUT := $(NATIVE)/target/ffi-terminal-example
LIB := $(NATIVE)/target/release/libmesh_avatar_ffi.a
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Werror
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
LDLIBS ?= -lm
RENDER_LDLIBS ?= -framework Foundation -framework QuartzCore -framework Metal -framework CoreGraphics -framework CoreFoundation -lobjc -liconv -lm
else
LDLIBS ?= -ldl -lpthread -lm
RENDER_LDLIBS ?= $(LDLIBS)
endif

.PHONY: all run render run-render terminal run-terminal
all: $(OUT)
$(OUT): main.c $(NATIVE)/include/mesh_avatar.h $(LIB)
	$(CC) $(CFLAGS) -I$(NATIVE)/include main.c $(LIB) $(LDLIBS) -o $@
run: $(OUT)
	$(OUT) $(NATIVE)/../samples/miko-qipao
render: $(RENDER_OUT)
$(RENDER_OUT): render.c $(NATIVE)/include/mesh_avatar.h $(NATIVE)/include/mesh_avatar_render.h $(LIB)
	$(CC) $(CFLAGS) -I$(NATIVE)/include render.c $(LIB) $(RENDER_LDLIBS) -o $@
run-render: $(RENDER_OUT)
	$(RENDER_OUT) $(NATIVE)/../samples/miko-qipao $(NATIVE)/target/ffi-render.ppm
terminal: $(TERMINAL_OUT)
$(TERMINAL_OUT): terminal.c $(NATIVE)/include/mesh_avatar.h $(NATIVE)/include/mesh_avatar_render.h $(LIB)
	$(CC) $(CFLAGS) -I$(NATIVE)/include terminal.c $(LIB) $(RENDER_LDLIBS) -o $@
run-terminal: $(TERMINAL_OUT)
	$(TERMINAL_OUT) $(NATIVE)/../samples/miko-qipao
