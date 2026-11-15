//! Memory-only normalization for DXGI's unrotated BGRA surface and separate
//! pointer. No graphics, input, logging or file operations occur in this module.
use crate::HostError;
use zeroize::Zeroizing;

pub(crate) const MAX_FRAME: usize = 256 * 1024 * 1024;
pub(crate) const MAX_CURSOR: usize = 4 * 1024 * 1024;
#[derive(Clone, Copy)]
pub(crate) enum Rotation {
    Identity,
    Clockwise90,
    Clockwise180,
    Clockwise270,
}
impl Rotation {
    pub(crate) fn from_code(code: i32) -> Result<Self, HostError> {
        match code {
            0 | 1 => Ok(Self::Identity),
            2 => Ok(Self::Clockwise90),
            3 => Ok(Self::Clockwise180),
            4 => Ok(Self::Clockwise270),
            _ => Err("Invalid sign-in display rotation".into()),
        }
    }
    pub(crate) fn size(self, width: u32, height: u32) -> (u32, u32) {
        match self {
            Self::Clockwise90 | Self::Clockwise270 => (height, width),
            _ => (width, height),
        }
    }
}
pub(crate) fn dimensions(width: u32, height: u32, pitch: u32) -> Result<(usize, usize), HostError> {
    let row = (width as usize)
        .checked_mul(4)
        .ok_or("Invalid sign-in frame dimensions")?;
    let length = (pitch as usize)
        .checked_mul(height as usize)
        .ok_or("Invalid sign-in frame dimensions")?;
    if width == 0
        || height == 0
        || row > pitch as usize
        || length > MAX_FRAME
        || length > isize::MAX as usize
    {
        return Err("Invalid sign-in frame dimensions".into());
    }
    Ok((row, length))
}
pub(crate) fn normalize(
    source: &[u8],
    width: u32,
    height: u32,
    pitch: u32,
    rotation: Rotation,
) -> Result<Zeroizing<Vec<u8>>, HostError> {
    let (row, length) = dimensions(width, height, pitch)?;
    if source.len() < length {
        return Err("Truncated sign-in frame".into());
    }
    let mut pixels = Zeroizing::new(vec![0u8; row * height as usize]);
    if matches!(rotation, Rotation::Identity) {
        for (y, output) in pixels.chunks_exact_mut(row).enumerate() {
            output.copy_from_slice(&source[y * pitch as usize..y * pitch as usize + row]);
        }
    } else {
        let (out_width, _) = rotation.size(width, height);
        for (index, output) in pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let (x, y) = (index % out_width as usize, index / out_width as usize);
            let (sx, sy) = match rotation {
                Rotation::Clockwise90 => (y, height as usize - 1 - x),
                Rotation::Clockwise180 => (width as usize - 1 - x, height as usize - 1 - y),
                Rotation::Clockwise270 => (width as usize - 1 - y, x),
                Rotation::Identity => unreachable!(),
            };
            let offset = sy * pitch as usize + sx * 4;
            output.copy_from_slice(&source[offset..offset + 4]);
        }
    }
    Ok(pixels)
}

struct Shape {
    kind: u32,
    width: usize,
    height: usize,
    pitch: usize,
    bytes: Zeroizing<Vec<u8>>,
}
#[derive(Default)]
pub(crate) struct Cursor {
    visible: bool,
    x: i32,
    y: i32,
    shape: Option<Shape>,
}
impl Cursor {
    pub(crate) fn position(&mut self, timestamp: i64, x: i32, y: i32, visible: bool) {
        // Desktop-only updates do not reset the last hardware pointer state.
        if timestamp != 0 {
            self.x = x;
            self.y = y;
            self.visible = visible;
        }
    }
    pub(crate) fn state(&self) -> (bool, i32, i32) {
        (self.visible, self.x, self.y)
    }
    pub(crate) fn needs_shape(&self) -> bool {
        self.visible && self.shape.is_none()
    }
    pub(crate) fn shape(
        &mut self,
        kind: u32,
        width: u32,
        height: u32,
        pitch: u32,
        bytes: Zeroizing<Vec<u8>>,
    ) -> Result<(), HostError> {
        let (width, full_height, pitch) = (width as usize, height as usize, pitch as usize);
        let required = pitch
            .checked_mul(full_height)
            .ok_or("Invalid sign-in pointer dimensions")?;
        let row = match kind {
            1 if full_height.is_multiple_of(2) => width.div_ceil(8),
            2 | 4 => width
                .checked_mul(4)
                .ok_or("Invalid sign-in pointer width")?,
            _ => return Err("Invalid sign-in pointer type or mask height".into()),
        };
        if width == 0
            || full_height == 0
            || width > 4096
            || full_height > 8192
            || row > pitch
            || required > MAX_CURSOR
            || bytes.len() < required
            || bytes.len() > MAX_CURSOR
        {
            return Err("Invalid sign-in pointer dimensions".into());
        }
        if kind == 4 {
            for y in 0..full_height {
                for x in 0..width {
                    if !matches!(bytes[y * pitch + x * 4 + 3], 0 | 255) {
                        return Err("Invalid sign-in pointer alpha mask".into());
                    }
                }
            }
        }
        self.shape = Some(Shape {
            kind,
            width,
            height: if kind == 1 {
                full_height / 2
            } else {
                full_height
            },
            pitch,
            bytes,
        });
        Ok(())
    }
    pub(crate) fn compose(
        &self,
        pixels: &mut [u8],
        width: u32,
        height: u32,
    ) -> Result<(), HostError> {
        let pitch = width.checked_mul(4).ok_or("Invalid sign-in frame width")?;
        let (_, length) = dimensions(width, height, pitch)?;
        if pixels.len() != length {
            return Err("Invalid sign-in frame length".into());
        }
        if !self.visible {
            return Ok(());
        } // driver already drew it, or hidden
        let shape = self.shape.as_ref().ok_or("Missing sign-in pointer shape")?;
        // Pointer Position is the top-left, already in desktop coordinates.
        // DXGI HotSpot is deliberately not subtracted or rotated here.
        let left = (self.x as i64).clamp(0, width as i64);
        let top = (self.y as i64).clamp(0, height as i64);
        let right = (self.x as i64 + shape.width as i64).clamp(0, width as i64);
        let bottom = (self.y as i64 + shape.height as i64).clamp(0, height as i64);
        for y in top..bottom {
            for x in left..right {
                let sx = (x - self.x as i64) as usize;
                let sy = (y - self.y as i64) as usize;
                let offset = y as usize * pitch as usize + x as usize * 4;
                let pixel = &mut pixels[offset..offset + 4];
                match shape.kind {
                    1 => {
                        let bit = 0x80 >> (sx % 8);
                        let and = if shape.bytes[sy * shape.pitch + sx / 8] & bit != 0 {
                            255
                        } else {
                            0
                        };
                        let xor =
                            if shape.bytes[(sy + shape.height) * shape.pitch + sx / 8] & bit != 0 {
                                255
                            } else {
                                0
                            };
                        for channel in &mut pixel[..3] {
                            *channel = (*channel & and) ^ xor;
                        }
                    }
                    2 | 4 => {
                        let input =
                            &shape.bytes[sy * shape.pitch + sx * 4..sy * shape.pitch + sx * 4 + 4];
                        for c in 0..3 {
                            pixel[c] = if shape.kind == 4 {
                                if input[3] == 255 {
                                    pixel[c] ^ input[c]
                                } else {
                                    input[c]
                                }
                            } else {
                                ((input[c] as u32 * input[3] as u32
                                    + pixel[c] as u32 * (255 - input[3] as u32)
                                    + 127)
                                    / 255) as u8
                            };
                        }
                    }
                    _ => return Err("Invalid cached sign-in pointer".into()),
                }
                pixel[3] = 255;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpu_readback_rejects_unbounded_and_truncated_rows() {
        assert_eq!(dimensions(2, 3, 16).unwrap(), (8, 48));
        for (width, height, pitch) in [
            (0, 3, 16),
            (2, 0, 16),
            (3, 2, 8),
            (8192, 8193, 32768),
            (u32::MAX, u32::MAX, u32::MAX),
        ] {
            assert!(dimensions(width, height, pitch).is_err());
        }
        assert!(normalize(&[0; 20], 2, 2, 12, Rotation::Identity).is_err());
    }
    #[test]
    fn non_square_padded_surface_rotates_in_all_four_orientations() {
        let mut source = Vec::new();
        for row in [[1, 2], [3, 4], [5, 6]] {
            for value in row {
                source.extend_from_slice(&[value, value + 10, value + 20, 255]);
            }
            source.extend_from_slice(&[99; 4]);
        }
        for (code, expected, size) in [
            (1, vec![1, 2, 3, 4, 5, 6], (2, 3)),
            (2, vec![5, 3, 1, 6, 4, 2], (3, 2)),
            (3, vec![6, 5, 4, 3, 2, 1], (2, 3)),
            (4, vec![2, 4, 6, 1, 3, 5], (3, 2)),
        ] {
            let rotation = Rotation::from_code(code).unwrap();
            assert_eq!(rotation.size(2, 3), size);
            let pixels = normalize(&source, 2, 3, 12, rotation).unwrap();
            assert_eq!(
                pixels
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|pixel| pixel[0])
                    .collect::<Vec<_>>(),
                expected
            );
            assert!(pixels
                .as_chunks::<4>()
                .0
                .iter()
                .all(|pixel| pixel[1] == pixel[0] + 10
                    && pixel[2] == pixel[0] + 20
                    && pixel[3] == 255));
        }
        assert!(Rotation::from_code(5).is_err());
    }
    #[test]
    fn mono_masks_cover_black_white_unchanged_and_inverted_pixels_with_clipping() {
        let mut cursor = Cursor::default();
        cursor
            .shape(1, 4, 2, 2, Zeroizing::new(vec![0x30, 99, 0x50, 99]))
            .unwrap();
        cursor.position(1, 0, 0, true);
        let mut pixels = [0x12, 0x34, 0x56, 255].repeat(4);
        cursor.compose(&mut pixels, 4, 1).unwrap();
        assert_eq!(
            pixels,
            [0, 0, 0, 255, 255, 255, 255, 255, 0x12, 0x34, 0x56, 255, 0xed, 0xcb, 0xa9, 255]
        );
        cursor.position(2, -1, 0, true);
        let mut clipped = [0x12, 0x34, 0x56, 255].repeat(2);
        cursor.compose(&mut clipped, 2, 1).unwrap();
        assert_eq!(clipped, [255, 255, 255, 255, 0x12, 0x34, 0x56, 255]);
        cursor.position(0, 0, 0, false);
        assert_eq!(cursor.state(), (true, -1, 0));
        cursor.position(3, i32::MIN, i32::MAX, true);
        let previous = clipped.clone();
        cursor.compose(&mut clipped, 2, 1).unwrap();
        assert_eq!(clipped, previous);
    }
    #[test]
    fn color_and_masked_color_follow_alpha_rules_without_padding_or_double_pointer() {
        let mut cursor = Cursor::default();
        cursor
            .shape(
                2,
                3,
                1,
                16,
                Zeroizing::new(vec![
                    200, 100, 0, 0, 200, 100, 0, 128, 200, 100, 0, 255, 99, 99, 99, 99,
                ]),
            )
            .unwrap();
        cursor.position(1, 0, 0, true);
        let mut pixels = [20, 40, 60, 255].repeat(3);
        cursor.compose(&mut pixels, 3, 1).unwrap();
        assert_eq!(
            pixels,
            [20, 40, 60, 255, 110, 70, 30, 255, 200, 100, 0, 255]
        );
        cursor
            .shape(4, 2, 1, 8, Zeroizing::new(vec![1, 2, 3, 0, 1, 2, 3, 255]))
            .unwrap();
        let mut masked = [20, 40, 60, 255].repeat(2);
        cursor.compose(&mut masked, 2, 1).unwrap();
        assert_eq!(masked, [1, 2, 3, 255, 21, 42, 63, 255]);
        cursor.position(2, 0, 0, false);
        let previous = masked.clone();
        cursor.compose(&mut masked, 2, 1).unwrap();
        assert_eq!(masked, previous);
        assert!(cursor
            .shape(4, 1, 1, 4, Zeroizing::new(vec![1, 2, 3, 128]))
            .is_err());
        assert!(cursor
            .shape(1, 1, 3, 1, Zeroizing::new(vec![0; 3]))
            .is_err());
        assert!(cursor
            .shape(2, 2, 1, 4, Zeroizing::new(vec![0; 4]))
            .is_err());
        assert!(cursor
            .shape(2, 4096, 4096, 16384, Zeroizing::new(vec![]))
            .is_err());
    }
}
