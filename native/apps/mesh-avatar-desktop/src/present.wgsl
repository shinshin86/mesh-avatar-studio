@group(0) @binding(0) var image: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let p = array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0))[index];
    return vec4f(p,0.0,1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let color = textureLoad(image,vec2i(position.xy),0);
    if color.a > 0.0 { return vec4f(color.rgb / color.a,color.a); }
    return vec4f(0.0);
}
