SELECT date, url, rank, REGEXP_EXTRACT(REGEXP_EXTRACT(
    response_body,
    r'(?sm)<head>.*(<link[^>]*?rel=["\'](?:shortcut icon|icon)["\'][^>]*>)+.*?<\/head>'
  ), r'href=["\']([^"\']+)["\']') as favicon FROM `httparchive.latest.requests`
WHERE client = "desktop" AND index = 1 AND rank <= 1000000 AND is_main_document = TRUE AND type="html" AND url = root_page
