-- READ ONLY: administrator runs in Aiven after confirming the explicit defaultdb schema.
-- Aggregate classifications only; no media URLs, content bodies, or identities returned.
SELECT CASE
         WHEN file_url LIKE '%drive.google.com%' OR file_url LIKE '%googleusercontent.com%' THEN 'google_drive'
         WHEN file_url LIKE '%cloudinary.com%' THEN 'cloudinary'
         WHEN file_url LIKE 'http%' THEN 'other_external_http'
         WHEN file_url IS NULL OR file_url = '' THEN 'missing_reference'
         ELSE 'relative_or_other'
       END AS provider_class,
       COUNT(*) AS media_records
FROM `defaultdb`.`media`
GROUP BY provider_class
ORDER BY provider_class;

SELECT 'posts_valid_json' AS metric, COUNT(*) AS record_count FROM `defaultdb`.`posts` WHERE JSON_VALID(content)
UNION ALL SELECT 'posts_opaque_content', COUNT(*) FROM `defaultdb`.`posts` WHERE content IS NOT NULL AND NOT JSON_VALID(content)
UNION ALL SELECT 'posts_drive_reference', COUNT(*) FROM `defaultdb`.`posts` WHERE content LIKE '%drive.google.com%'
UNION ALL SELECT 'posts_cloudinary_reference', COUNT(*) FROM `defaultdb`.`posts` WHERE content LIKE '%cloudinary%'
UNION ALL SELECT 'pages_drive_reference', COUNT(*) FROM `defaultdb`.`pages` WHERE content LIKE '%drive.google.com%'
UNION ALL SELECT 'pages_cloudinary_reference', COUNT(*) FROM `defaultdb`.`pages` WHERE content LIKE '%cloudinary%';
