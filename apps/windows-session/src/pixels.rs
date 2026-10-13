//! Bounded BT.601 limited-range BGRA → NV12 conversion with aspect-preserving fit.
pub fn nv12(
    bgra: &[u8],
    sw: u32,
    sh: u32,
    output: &mut [u8],
    w: u32,
    h: u32,
) -> Result<(), &'static str> {
    let source_size = u64::from(sw)
        .checked_mul(u64::from(sh))
        .and_then(|size| size.checked_mul(4))
        .ok_or("Source dimensions overflow")?;
    let target_size = u64::from(w) * u64::from(h) * 3 / 2;
    if sw == 0
        || sh == 0
        || source_size > 64 * 1024 * 1024
        || source_size != bgra.len() as u64
        || w < 2
        || h < 2
        || w > 1920
        || h > 1080
        || !w.is_multiple_of(2)
        || !h.is_multiple_of(2)
        || target_size != output.len() as u64
    {
        return Err("Invalid bounded pixel frame");
    }
    let (fw, fh) = if u64::from(sw) * u64::from(h) > u64::from(sh) * u64::from(w) {
        (
            w,
            ((u64::from(sh) * u64::from(w) / u64::from(sw)) as u32).max(2) & !1,
        )
    } else {
        (
            ((u64::from(sw) * u64::from(h) / u64::from(sh)) as u32).max(2) & !1,
            h,
        )
    };
    let ox = ((w - fw) / 2) & !1;
    let oy = ((h - fh) / 2) & !1;
    let y_size = (w * h) as usize;
    output[..y_size].fill(16);
    output[y_size..].fill(128);
    let pixel = |x: u32, y: u32| {
        let sx = u64::from(x) * u64::from(sw) / u64::from(fw);
        let sy = u64::from(y) * u64::from(sh) / u64::from(fh);
        let offset = ((sy * u64::from(sw) + sx) * 4) as usize;
        [
            i32::from(bgra[offset + 2]),
            i32::from(bgra[offset + 1]),
            i32::from(bgra[offset]),
        ]
    };
    for y in (0..fh).step_by(2) {
        for x in (0..fw).step_by(2) {
            let mut rgb = [0; 3];
            for dy in 0..2 {
                for dx in 0..2 {
                    let [r, g, b] = pixel(x + dx, y + dy);
                    output[((oy + y + dy) * w + ox + x + dx) as usize] =
                        (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(16, 235) as u8;
                    rgb[0] += r;
                    rgb[1] += g;
                    rgb[2] += b;
                }
            }
            let [r, g, b] = rgb.map(|v| v / 4);
            let offset = y_size + (((oy + y) / 2) * w + ox + x) as usize;
            output[offset] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            output[offset + 1] =
                (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bgra_color_order_range_and_letterboxing_match_nv12() {
        let mut output = vec![0; 24];
        nv12(&[0, 0, 255, 255].repeat(4), 2, 2, &mut output, 4, 4).unwrap();
        assert_eq!(&output[..16], &[82; 16]);
        assert_eq!(&output[16..], &[90, 240, 90, 240, 90, 240, 90, 240]);
        nv12(&[255, 255, 255, 255].repeat(8), 2, 4, &mut output, 4, 4).unwrap();
        assert_eq!(&output[..4], &[235, 235, 16, 16]);
        assert!(output[16..].iter().all(|value| *value == 128));
        assert!(nv12(&[0; 3], 2, 2, &mut output, 4, 4).is_err());
        assert!(nv12(&[0; 16], 2, 2, &mut output, 3, 4).is_err());
    }
}
