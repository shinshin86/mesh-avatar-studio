use anyhow::{bail, ensure, Context, Result};
use mesh_avatar_core::{
    engine::{random::SeededRandom, rig::PARAMS},
    format::AvatarPackage,
    Avatar, AvatarOptions,
};
use mesh_avatar_wgpu::{headless_device, wgpu, Fit, Renderer, ViewOptions};
use std::{collections::BTreeMap, env, fs, path::PathBuf};

struct Args {
    avatar: PathBuf,
    output: PathBuf,
    pose: Option<PathBuf>,
    seconds: f64,
    size: [u32; 2],
    fit: Fit,
    pad_top: Option<f64>,
    pad_side: Option<f64>,
    samples: u32,
    seed: u32,
    no_sprites: bool,
    expression: Option<String>,
}
fn usage() -> &'static str {
    "Usage: mesh-avatar-render <avatar> [--pose params.json] [--seconds N] [--size WxH] -o out.png\nOptions: --fit contain|cover --pad-top N --pad-side N --samples 1|4 --seed N --no-sprites --expression NAME"
}
fn parse() -> Result<Option<Args>> {
    let mut args = env::args().skip(1);
    let Some(first) = args.next() else {
        bail!("{}", usage());
    };
    if matches!(first.as_str(), "--help" | "-h") {
        println!("{}", usage());
        return Ok(None);
    }
    let mut out = Args {
        avatar: first.into(),
        output: PathBuf::new(),
        pose: None,
        seconds: 0.0,
        size: [512, 640],
        fit: Fit::Contain,
        pad_top: None,
        pad_side: None,
        samples: 4,
        seed: 0,
        no_sprites: false,
        expression: None,
    };
    while let Some(flag) = args.next() {
        if flag == "--no-sprites" {
            out.no_sprites = true;
            continue;
        }
        let value = args
            .next()
            .with_context(|| format!("{flag}: missing value"))?;
        match flag.as_str() {
            "-o" | "--output" => out.output = value.into(),
            "--pose" => out.pose = Some(value.into()),
            "--seconds" => out.seconds = value.parse()?,
            "--size" => {
                let (w, h) = value.split_once('x').context("size must be WxH")?;
                out.size = [w.parse()?, h.parse()?];
            }
            "--fit" => {
                out.fit = match value.as_str() {
                    "contain" => Fit::Contain,
                    "cover" => Fit::Cover,
                    _ => bail!("fit must be contain or cover"),
                }
            }
            "--pad-top" => out.pad_top = Some(value.parse()?),
            "--pad-side" => out.pad_side = Some(value.parse()?),
            "--samples" => out.samples = value.parse()?,
            "--seed" => out.seed = value.parse()?,
            "--expression" => out.expression = Some(value),
            _ => bail!("unknown option: {flag}\n{}", usage()),
        }
    }
    ensure!(!out.output.as_os_str().is_empty(), "-o is required");
    ensure!(
        out.seconds.is_finite() && out.seconds >= 0.0,
        "seconds must be finite and non-negative"
    );
    Ok(Some(out))
}
fn run(args: Args) -> Result<()> {
    let mut package = AvatarPackage::open(&args.avatar)?;
    if args.no_sprites {
        package.sprites = None;
    }
    let view = ViewOptions {
        image_size: [package.rig.image.width, package.rig.image.height],
        pad_top: args.pad_top.unwrap_or(package.rig.view.pad_top),
        pad_side: args.pad_side.unwrap_or(package.rig.view.pad_side),
        fit: args.fit,
    };
    view.transform(args.size)?;
    let mut avatar = Avatar::with_rng(
        package,
        AvatarOptions::default(),
        Box::new(SeededRandom::new(args.seed)),
    )?;
    if let Some(path) = args.pose {
        let values: BTreeMap<String, f64> =
            serde_json::from_slice(&fs::read(path)?).context("invalid pose parameter object")?;
        let mut parameters: BTreeMap<String, f64> = PARAMS
            .iter()
            .map(|p| (p.id.to_owned(), p.default))
            .collect();
        parameters.extend(values);
        avatar.set_parameters(parameters);
        avatar.set_auto_idle(false);
        avatar.set_auto_motion(false);
    }
    if let Some(expression) = args.expression {
        avatar.set_expression(&expression);
    }
    let mut frame = avatar.tick(0.0);
    // Mirror advance(seconds, 60): a whole number of fixed simulation steps.
    for _ in 0..(args.seconds * 60.0).round() as usize {
        frame = avatar.tick(1.0 / 60.0);
    }
    let (device, queue, info) = pollster::block_on(headless_device())?;
    eprintln!(
        "GPU: {} ({:?}), {}x{}, {} samples",
        info.name, info.backend, args.size[0], args.size[1], args.samples
    );
    let mut renderer = Renderer::new(
        &device,
        &queue,
        wgpu::TextureFormat::Rgba8Unorm,
        args.samples,
        avatar.textures(),
    )?;
    let rgba = renderer.render_rgba(&frame, args.size, &view)?;
    if let Some(parent) = args.output.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let mut encoder =
        png::Encoder::new(fs::File::create(&args.output)?, args.size[0], args.size[1]);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(&rgba)?;
    Ok(())
}
fn main() {
    if let Err(error) = parse().and_then(|args| args.map(run).transpose()) {
        eprintln!("mesh-avatar-render: {error:#}");
        std::process::exit(1);
    }
}
