use pdf_oxide::document::PdfDocument;
use pdf_oxide::geometry::Rect;
use serde::Serialize;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

const HORIZONTAL_LABEL: &str = "H-AXIS";
const ROTATED_LABEL: &str = "R-AXIS";
const EDGE_TOLERANCE: f32 = 1.5;

#[derive(Clone, Copy)]
struct FixtureSpec {
    name: &'static str,
    rotation: i32,
    media_box: [f32; 4],
    crop_box: Option<[f32; 4]>,
    user_unit: f32,
}

const FIXTURES: [FixtureSpec; 7] = [
    FixtureSpec {
        name: "plain",
        rotation: 0,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: None,
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "rotate-90",
        rotation: 90,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: None,
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "rotate-180",
        rotation: 180,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: None,
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "rotate-270",
        rotation: 270,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: None,
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "crop-offset",
        rotation: 0,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: Some([40.0, 60.0, 360.0, 540.0]),
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "rotate-90-crop-offset",
        rotation: 90,
        media_box: [20.0, 30.0, 420.0, 630.0],
        crop_box: Some([60.0, 90.0, 380.0, 570.0]),
        user_unit: 1.0,
    },
    FixtureSpec {
        name: "user-unit-2",
        rotation: 0,
        media_box: [0.0, 0.0, 400.0, 600.0],
        crop_box: None,
        user_unit: 2.0,
    },
];

#[derive(Clone, Copy, Debug, Serialize)]
struct Corners([f32; 4]);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpanProof {
    label: &'static str,
    text: String,
    rotation_degrees: f32,
    source_box: Corners,
    normalized_box: Corners,
    raw_character_path_box: Corners,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureProof {
    name: &'static str,
    file: String,
    page_rotation: i32,
    media_box: [f32; 4],
    crop_box: Option<[f32; 4]>,
    user_unit: f32,
    spans: Vec<SpanProof>,
}

fn rect_to_corners(rect: Rect) -> Corners {
    // pdf_oxide normalizes both sizes. Its x and y values are the lower-left corner.
    Corners([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height])
}

#[cfg(test)]
fn corners_to_rect(corners: Corners) -> Rect {
    let [x0, y0, x1, y1] = corners.0;
    Rect::new(x0, y0, x1 - x0, y1 - y0)
}

fn orient_flat_span_box(rect: Rect, content_rotation: f32) -> Rect {
    let angle = content_rotation.to_radians();
    let advance = (angle.cos() * rect.width, angle.sin() * rect.width);
    let font_height = (-angle.sin() * rect.height, angle.cos() * rect.height);
    let points = [
        (rect.x, rect.y),
        (rect.x + advance.0, rect.y + advance.1),
        (rect.x + font_height.0, rect.y + font_height.1),
        (
            rect.x + advance.0 + font_height.0,
            rect.y + advance.1 + font_height.1,
        ),
    ];
    let x0 = points
        .iter()
        .map(|point| point.0)
        .fold(f32::INFINITY, f32::min);
    let y0 = points
        .iter()
        .map(|point| point.1)
        .fold(f32::INFINITY, f32::min);
    let x1 = points
        .iter()
        .map(|point| point.0)
        .fold(f32::NEG_INFINITY, f32::max);
    let y1 = points
        .iter()
        .map(|point| point.1)
        .fold(f32::NEG_INFINITY, f32::max);
    Rect::new(x0, y0, x1 - x0, y1 - y0)
}

fn normalize_span_box(span_box: Rect, content_rotation: f32) -> Rect {
    // extract_structured reads raw spans. It does not call the path that applies /Rotate.
    // pdf_oxide keeps the advance on the x-axis, even for rotated text.
    // Apply only the content angle. pdf.js will apply the page transforms later.
    orient_flat_span_box(span_box, content_rotation)
}

fn union_rects<I>(rects: I) -> Option<Rect>
where
    I: IntoIterator<Item = Rect>,
{
    let mut rects = rects.into_iter();
    let first = rects.next()?;
    let mut x0 = first.x;
    let mut y0 = first.y;
    let mut x1 = first.x + first.width;
    let mut y1 = first.y + first.height;
    for rect in rects {
        x0 = x0.min(rect.x);
        y0 = y0.min(rect.y);
        x1 = x1.max(rect.x + rect.width);
        y1 = y1.max(rect.y + rect.height);
    }
    Some(Rect::new(x0, y0, x1 - x0, y1 - y0))
}

fn assert_same_box(actual: Rect, expected: Rect, context: &str) {
    let actual = rect_to_corners(actual).0;
    let expected = rect_to_corners(expected).0;
    for (index, (actual_edge, expected_edge)) in actual.iter().zip(expected).enumerate() {
        assert!(
            (actual_edge - expected_edge).abs() <= EDGE_TOLERANCE,
            "{context}: edge {index} differs: actual={actual:?}, expected={expected:?}"
        );
    }
}

/// Builds a minimal one-page PDF (version 1.4) in memory from the given
/// fixture specification.
///
/// The page carries the spec's `/MediaBox`. It also carries `/CropBox`,
/// `/Rotate`, and `/UserUnit` when their values differ from the defaults.
/// The fixtures use whole numbers for every page setting.
///
/// Every page contains the same fixed content: two colored marker
/// rectangles and two 24pt Helvetica text labels, each drawn with its own
/// text matrix — one horizontal and one rotated 90 degrees. The marker and
/// label positions are deliberately asymmetric so that a wrong axis,
/// origin, or page transform moves at least one bounding box far away,
/// making coordinate-handling bugs easy to detect.
///
/// The document is assembled manually as a classic (non-compressed) PDF
/// with five numbered objects (catalog, page tree, page, content stream,
/// and font), followed by a cross-reference table and trailer.
///
/// # Arguments
///
/// * `spec` - The fixture specification describing the page geometry and
///   rotation to encode.
///
/// # Returns
///
/// The complete PDF file contents, ready to be written to disk or parsed
/// from memory.
fn pdf_bytes(spec: FixtureSpec) -> Vec<u8> {
    let media = spec.media_box.map(|value| value as i32);
    let crop = spec.crop_box.map(|values| values.map(|value| value as i32));
    // /CropBox is optional. /Rotate is omitted when zero. Both are truncated to integers.
    let crop_entry = crop
        .map(|[x0, y0, x1, y1]| format!(" /CropBox [{x0} {y0} {x1} {y1}]"))
        .unwrap_or_default();
    let rotate_entry = if spec.rotation == 0 {
        String::new()
    } else {
        format!(" /Rotate {}", spec.rotation)
    };
    let user_unit_entry = if spec.user_unit == 1.0 {
        String::new()
    } else {
        format!(" /UserUnit {}", spec.user_unit as i32)
    };
    let [x0, y0, x1, y1] = media;
    // /MediaBox is required. It is always present.
    let page = format!(
        "/Type /Page /Parent 2 0 R /MediaBox [{x0} {y0} {x1} {y1}]{crop_entry}{rotate_entry}{user_unit_entry}"
    );

    // The labels use different text matrices. Their positions are asymmetric.
    // A wrong axis, origin, or page transform moves at least one box far away.
    let content = concat!(
        "q 0.86 0.92 1 rg 94 412 100 30 re f Q\n",
        "q 1 0.90 0.80 rg 268 134 30 96 re f Q\n",
        "BT /F1 24 Tf 1 0 0 1 100 420 Tm (H-AXIS) Tj ET\n",
        "BT /F1 24 Tf 0 1 -1 0 280 140 Tm (R-AXIS) Tj ET\n"
    )
    .as_bytes();

    let mut pdf = if spec.user_unit == 1.0 {
        b"%PDF-1.4\n".to_vec()
    } else {
        b"%PDF-1.6\n".to_vec()
    };
    let mut offsets = vec![0usize; 6];

    offsets[1] = pdf.len();
    pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offsets[2] = pdf.len();
    pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    offsets[3] = pdf.len();
    pdf.extend_from_slice(format!("3 0 obj\n<< {page} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n").as_bytes());
    offsets[4] = pdf.len();
    pdf.extend_from_slice(format!("4 0 obj\n<< /Length {} >>\nstream\n", content.len()).as_bytes());
    pdf.extend_from_slice(content);
    pdf.extend_from_slice(b"endstream\nendobj\n");
    offsets[5] = pdf.len();
    pdf.extend_from_slice(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

    let xref = pdf.len();
    pdf.extend_from_slice(b"xref\n0 6\n0000000000 65535 f\r\n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n\r\n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
    );
    pdf
}

/// Creates one PDF fixture and checks the page data that `pdf_oxide` reads.
///
/// The function writes the fixture for the browser proof. It checks the page rotation and media box against the fixture specification.
/// It records the source, normalized, and raw character boxes for both text labels.
fn prove_fixture(spec: FixtureSpec, fixture_dir: &Path) -> Result<FixtureProof, Box<dyn Error>> {
    let bytes = pdf_bytes(spec);
    let file_name = format!("{}.pdf", spec.name);
    fs::write(fixture_dir.join(&file_name), &bytes)?;

    let document = PdfDocument::from_bytes(bytes)?;
    let page_rotation = document.get_page_rotation(0)?;
    let media_tuple = document.get_page_media_box(0)?;
    let media_box = [media_tuple.0, media_tuple.1, media_tuple.2, media_tuple.3];
    assert_eq!(page_rotation, spec.rotation);
    assert_eq!(media_box, spec.media_box);

    let page = document.extract_structured(0)?;
    let source_spans = page.regions.iter().flat_map(|region| region.spans.iter());
    let characters = document.extract_chars(0)?;

    let mut spans = Vec::new();
    for (label, expected_text, content_is_rotated) in [
        ("horizontal", HORIZONTAL_LABEL, false),
        ("rotated", ROTATED_LABEL, true),
    ] {
        let span = source_spans
            .clone()
            .find(|span| span.text.contains(expected_text))
            .ok_or_else(|| format!("{}: missing {expected_text} structured span", spec.name))?;
        let raw_character_box = union_rects(
            characters
                .iter()
                .filter(|character| (character.rotation_degrees.abs() > 0.5) == content_is_rotated)
                .map(|character| character.bbox),
        )
        .ok_or_else(|| format!("{}: missing {expected_text} raw characters", spec.name))?;

        let normalized = normalize_span_box(span.bbox, span.rotation_degrees);
        // `extract_chars()` gives zero-width boxes for this rotated text.
        // The browser proof checks both normalized boxes against the text layer.
        if !content_is_rotated {
            assert_same_box(
                normalized,
                raw_character_box,
                &format!("{} {label}", spec.name),
            );
        }
        spans.push(SpanProof {
            label,
            text: span.text.clone(),
            rotation_degrees: span.rotation_degrees,
            source_box: rect_to_corners(span.bbox),
            normalized_box: rect_to_corners(normalized),
            raw_character_path_box: rect_to_corners(raw_character_box),
        });
    }

    Ok(FixtureProof {
        name: spec.name,
        file: format!("fixtures/{file_name}"),
        page_rotation,
        media_box,
        crop_box: spec.crop_box,
        user_unit: spec.user_unit,
        spans,
    })
}

fn run_proof(root: &Path) -> Result<Vec<FixtureProof>, Box<dyn Error>> {
    let fixture_dir = root.join("fixtures");
    let artifact_dir = root.join("artifacts");
    fs::create_dir_all(&fixture_dir)?;
    fs::create_dir_all(&artifact_dir)?;
    FIXTURES
        .iter()
        .copied()
        .map(|spec| prove_fixture(spec, &fixture_dir))
        .collect()
}

fn main() -> Result<(), Box<dyn Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let proof = run_proof(&root)?;
    let output = root.join("artifacts/boxes.json");
    fs::write(&output, serde_json::to_vec_pretty(&proof)?)?;
    println!(
        "wrote {} fixture proofs to {}",
        proof.len(),
        output.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_boxes_match_raw_character_coordinates_on_every_fixture() {
        let temp = std::env::temp_dir().join(format!(
            "chive-pdf-ir-coordinate-proof-{}",
            std::process::id()
        ));
        let proof = run_proof(&temp).expect("all coordinate fixtures must pass");
        assert_eq!(proof.len(), FIXTURES.len());
        fs::remove_dir_all(temp).expect("temporary proof directory must be removed");
    }

    #[test]
    fn structured_boxes_keep_absolute_source_coordinates() {
        let temp = std::env::temp_dir().join(format!(
            "chive-pdf-ir-source-frame-proof-{}",
            std::process::id()
        ));
        fs::create_dir_all(&temp).expect("temporary fixture directory must exist");
        for spec in FIXTURES {
            let proof = prove_fixture(spec, &temp).expect("fixture must parse");
            let horizontal = proof
                .spans
                .iter()
                .find(|span| span.label == "horizontal")
                .expect("horizontal span must exist");
            let rotated = proof
                .spans
                .iter()
                .find(|span| span.label == "rotated")
                .expect("rotated span must exist");
            assert_same_box(
                corners_to_rect(horizontal.source_box),
                Rect::new(100.0, 420.0, 80.016, 24.0),
                spec.name,
            );
            assert_same_box(
                corners_to_rect(rotated.source_box),
                Rect::new(280.0, 140.0, 80.016, 24.0),
                spec.name,
            );
        }
        fs::remove_dir_all(temp).expect("temporary fixture directory must be removed");
    }

    #[test]
    fn rotated_text_uses_its_text_matrix_axis() {
        let temp = std::env::temp_dir().join(format!(
            "chive-pdf-ir-rotated-box-proof-{}",
            std::process::id()
        ));
        fs::create_dir_all(&temp).expect("temporary fixture directory must exist");
        let proof = prove_fixture(FIXTURES[0], &temp).expect("plain fixture must parse");
        let rotated = proof
            .spans
            .iter()
            .find(|span| span.label == "rotated")
            .expect("rotated span must exist");

        let expected = Corners([256.0, 140.0, 280.0, 220.016]);
        assert_same_box(
            corners_to_rect(rotated.normalized_box),
            corners_to_rect(expected),
            "rotated text box",
        );
        fs::remove_dir_all(temp).expect("temporary fixture directory must be removed");
    }

    #[test]
    fn corners_use_the_lower_left_rect_origin() {
        let rect = Rect::new(11.0, 23.0, 41.0, 17.0);
        let corners = rect_to_corners(rect);
        assert_eq!(corners.0, [11.0, 23.0, 52.0, 40.0]);
        assert_eq!(corners_to_rect(corners), rect);
    }
}
