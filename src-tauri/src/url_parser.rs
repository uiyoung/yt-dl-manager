//! 붙여넣은 텍스트에서 YouTube 링크를 찾아 영상 ID / 재생목록 ID로 정규화한다.

use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    /// 11자리 영상 ID
    Video(String),
    /// 재생목록 ID (영상 ID 없이 재생목록만 가리키는 링크)
    Playlist(String),
}

/// 찾은 링크와 사용자가 붙여넣은 원래 주소
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub link: Link,
    pub url: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParseResult {
    /// 붙여넣기 안에서 중복을 제거한 링크 (입력 순서 유지)
    pub links: Vec<Found>,
    /// 붙여넣기 안에서 앞에 나온 링크와 겹쳐서 제외된 주소
    pub paste_duplicates: Vec<String>,
    /// YouTube 주소처럼 보이지만 영상/재생목록을 찾지 못한 링크
    pub unrecognized: Vec<String>,
}

static URL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)(?:https?://)?\b(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)/[^\s<>"'(),\[\]]*"#,
    )
    .unwrap()
});

static VIDEO_RES: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"(?i)youtu\.be/([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)",
        r"(?i)/(?:shorts|embed|live|v|e)/([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)",
        r"[?&]v=([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)",
    ]
    .iter()
    .map(|p| Regex::new(p).unwrap())
    .collect()
});

static LIST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[?&]list=([A-Za-z0-9_-]+)").unwrap());

/// 링크 하나를 분류한다. 영상 ID가 있으면 재생목록 파라미터보다 우선한다.
pub fn classify(url: &str) -> Option<Link> {
    for re in VIDEO_RES.iter() {
        if let Some(c) = re.captures(url) {
            return Some(Link::Video(c[1].to_string()));
        }
    }
    LIST_RE
        .captures(url)
        .map(|c| Link::Playlist(c[1].to_string()))
}

/// 공백·쉼표·괄호·따옴표로 나눈 낱말 (영상 ID만 따로 붙여넣은 경우를 찾는 데 쓴다)
static TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[^\s,;()\[\]<>"'`]+"#).unwrap());

/// 링크와, 낱말 하나가 통째로 11자리 영상 ID인 것을 입력 순서대로 찾는다.
/// 영상 ID는 링크 바깥에 있을 때만 인정한다.
fn candidates(text: &str) -> Vec<(String, Option<Link>)> {
    let urls: Vec<_> = URL_RE.find_iter(text).collect();
    let mut found: Vec<(usize, String, Option<Link>)> = urls
        .iter()
        .map(|m| (m.start(), m.as_str().to_string(), classify(m.as_str())))
        .collect();
    for t in TOKEN_RE.find_iter(text) {
        if urls.iter().any(|u| t.start() < u.end() && u.start() < t.end()) {
            continue;
        }
        // 문장 끝 마침표 등은 떼고 본다
        let s = t.as_str().trim_matches(|c: char| matches!(c, '.' | ':' | '!' | '?'));
        if is_video_id(s) {
            found.push((t.start(), s.to_string(), Some(Link::Video(s.to_string()))));
        }
    }
    found.sort_by_key(|f| f.0);
    found.into_iter().map(|(_, s, l)| (s, l)).collect()
}

pub fn parse_links(text: &str) -> ParseResult {
    let mut res = ParseResult::default();
    for (url, link) in candidates(text) {
        match link {
            Some(link) => {
                if res.links.iter().any(|f| f.link == link) {
                    res.paste_duplicates.push(url);
                } else {
                    res.links.push(Found { link, url });
                }
            }
            None => res.unrecognized.push(url),
        }
    }
    res
}

pub fn video_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

pub fn playlist_url(id: &str) -> String {
    format!("https://www.youtube.com/playlist?list={id}")
}

pub fn is_video_id(s: &str) -> bool {
    s.len() == 11
        && s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(id: &str) -> Link {
        Link::Video(id.into())
    }

    #[test]
    fn recognizes_all_url_forms() {
        let cases = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "http://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
            "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ?start=10",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
        ];
        for c in cases {
            assert_eq!(classify(c), Some(v("dQw4w9WgXcQ")), "{c}");
        }
    }

    #[test]
    fn playlist_only_link() {
        assert_eq!(
            classify("https://www.youtube.com/playlist?list=PLabc_123-XY"),
            Some(Link::Playlist("PLabc_123-XY".into()))
        );
    }

    #[test]
    fn multi_paste_with_noise_and_duplicates() {
        let text = "봐봐 https://youtu.be/aaaaaaaaaaa, 그리고\n\
                    https://www.youtube.com/watch?v=bbbbbbbbbbb\t\
                    https://www.youtube.com/watch?v=aaaaaaaaaaa&t=3 \
                    (https://www.youtube.com/shorts/ccccccccccc) https://example.com/x";
        let r = parse_links(text);
        let links: Vec<Link> = r.links.iter().map(|f| f.link.clone()).collect();
        assert_eq!(links, vec![v("aaaaaaaaaaa"), v("bbbbbbbbbbb"), v("ccccccccccc")]);
        assert_eq!(r.links[0].url, "https://youtu.be/aaaaaaaaaaa");
        assert_eq!(
            r.paste_duplicates,
            vec!["https://www.youtube.com/watch?v=aaaaaaaaaaa&t=3".to_string()]
        );
        assert!(r.unrecognized.is_empty());
    }

    #[test]
    fn bare_video_ids() {
        let text = "dQw4w9WgXcQ\nhttps://youtu.be/aaaaaaaaaaa, bbbbbbbbbbb.\n\
                    aaaaaaaaaaa (ccc-ccc_ccc) 짧은id 12345678901234 \
                    https://example.com/ddddddddddd https://www.youtube.com/watch?v=eeeeeeeeeee";
        let r = parse_links(text);
        let links: Vec<Link> = r.links.iter().map(|f| f.link.clone()).collect();
        assert_eq!(
            links,
            vec![v("dQw4w9WgXcQ"), v("aaaaaaaaaaa"), v("bbbbbbbbbbb"), v("ccc-ccc_ccc"), v("eeeeeeeeeee")]
        );
        assert_eq!(r.links[0].url, "dQw4w9WgXcQ");
        assert_eq!(r.paste_duplicates, vec!["aaaaaaaaaaa".to_string()]);
        assert!(r.unrecognized.is_empty());
    }

    #[test]
    fn rejects_wrong_length_ids_and_other_hosts() {
        assert_eq!(classify("https://youtu.be/short"), None);
        assert_eq!(classify("https://www.youtube.com/watch?v=toolongid1234"), None);
        let r = parse_links("https://notyoutube.com/watch?v=dQw4w9WgXcQ");
        assert!(r.links.is_empty());
        let r = parse_links("https://www.youtube.com/@channel");
        assert_eq!(r.unrecognized, vec!["https://www.youtube.com/@channel".to_string()]);
    }
}
