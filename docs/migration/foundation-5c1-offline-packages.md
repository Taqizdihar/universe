# Foundation 5C.1 — Paket migrasi offline dan rencana rehearsal

Status: **persiapan offline**, bukan migrasi maupun persetujuan cutover. Tidak ada
koneksi database, eksekusi SQL, perubahan startup aplikasi, deployment, atau perubahan
routing API. `V2`, Aiven `defaultdb`, dan Kroombox `uniin_universe` tidak menjadi target.
Semua SQL hanya ditulis sebagai berkas untuk administrator. Target SQL dikunci ke
`uniin_universe_reh`. Skema 28 tabel Foundation 5B yang sudah dibuat tidak diubah.

## Batas format dan konsistensi snapshot

Format yang didukung hanya **JSON terstruktur per tabel**, bukan SQL dump atau CSV.
Gunakan `JSON.parse` dan adapter konten Foundation 1 untuk menolak JSON ambigu,
termasuk duplicate object keys; jangan mencoba mengonversi SQL memakai regex.

Administrator harus memperoleh ekspor dengan izin eksplisit, menggunakan fasilitas
backup/export resmi Aiven atau eksportir lokal tepercaya pada workstation privat.
Gunakan satu consistent snapshot InnoDB pada satu titik waktu, zona waktu UTC, dan
metadata/counts dari snapshot yang sama. Jika phpMyAdmin mengekspor setiap tabel
melalui transaksi berbeda, hasil itu **belum merupakan** consistent snapshot; jangan
mengisi `consistentSnapshot: true`. Koordinasikan backup konsisten atau jeda penulisan
oleh administrator. Tool ini tidak mengambil snapshot dan tidak mempunyai akses Aiven.
Jangan mengunggah snapshot, evidence, hash password, atau API key ke chat/AI/layanan lain.

Simpan direktori input di volume privat terenkripsi **di luar checkout Git mana pun**,
mode `0700`, file `0600`, dimiliki pengguna lokal. Symlink, hardlink, serta file >64 MiB
ditolak. Batas ini per tabel, bukan dukungan streaming untuk database besar. Untuk
snapshot lebih besar dibutuhkan pengembangan eksportir/importer streaming terpisah;
jangan memecah snapshot dengan menghilangkan record demi melewati pemeriksaan.

Buat tepat satu array JSON untuk setiap nama tabel dalam
`database/schema-evidence/foundation-4/aiven-source-schema.json` (19 tabel):

```text
activity_logs.json      api_keys.json          comments.json
contact_inquiries.json global_faqs.json       layouts.json
media.json             media_folders.json     notifications.json
pages.json             plugins.json           post_categories.json
posts.json             settings.json          tenant_users.json
tenants.json           update_history.json    update_images.json
users.json             snapshot.json
```

Setiap object row harus mempunyai **semua dan hanya** kolom skema legacy, termasuk
kolom nullable yang harus ditulis sebagai JSON `null`. Nilai integer berupa JSON number
integer aman (ID positif, rentang INT MySQL); bukan string, boolean, atau floating point.
Teks UTF-8 tetap string, termasuk kolom LONGTEXT berisi JSON: jangan parse dan serialize
ulang kontennya. Tanggal `YYYY-MM-DD`, timestamp/datetime `YYYY-MM-DD HH:mm:ss` dalam UTC.
Zero dates, enum tidak dikenal, kolom hilang/ekstra, Unicode rusak, ID duplikat, tanggal
mustahil, count/checksum tidak cocok ditolak. Skema legacy saat ini tidak punya BLOB;
encoder SQL mendukung binary `{base64: "..."}`, tetapi snapshot kolom yang tidak ada
dalam skema tidak diterima. Ketidakcocokan skema memerlukan review terpisah, bukan coercion.

`update_history` memakai PK **update_id**, bukan id. Parent folder diurutkan sebelum
anak; siklus folder ditolak. ID FK NULL dipertahankan. Referensi bisnis tenant/user
juga diperiksa meski legacy tidak mempunyai constraint SQL.

`snapshot.json` mempunyai struktur berikut; tambahkan
seluruh 19 entri dan checksum byte file sebenarnya, jangan memakai placeholder:

```json
{
  "version": 1,
  "consistentSnapshot": true,
  "timeZone": "+00:00",
  "tables": [
    {"name": "users", "count": 0, "sha256": "<SHA256 file users.json>"}
  ]
}
```

Array kosong tetap harus diekspor dan dicatat. Count harus diperoleh dari snapshot
yang sama dan dibandingkan dengan row JSON, bukan diturunkan hanya untuk menutupi
missing rows. Checksum dan deklarasi manifest membuktikan konsistensi file lokal;
**tidak membuktikan otorisasi atau transaksi ekspor sumber**. Review ekspor diperlukan.

## Menjalankan persiapan

Gunakan Node 24 dan dependensi backend yang sudah tersedia (`npm ci --prefix backend`).
Di workstation privat, siapkan parent direktori terlebih dahulu. Contoh lokasi di bawah
bukan checkout Git. Jangan menjalankan contoh dengan data produksi di sesi AI.

```bash
umask 077
mkdir -p /private/universe-migration/input /private/universe-migration/evidence
node -e "require('fs').writeFileSync('/private/universe-migration/key',require('crypto').randomBytes(32),{mode:0o600,flag:'wx'})"
node backend/migration/package.cjs \
  --input=/private/universe-migration/input \
  --output=/private/universe-migration/plan-a \
  --key=/private/universe-migration/key
```

Ganti `/private` dengan volume privat yang memang tersedia. Key HMAC 32 byte harus
disimpan privat dan dipakai ulang agar fingerprint/rencana deterministik. Jangan
mencetaknya, memasukkannya ke Git, atau mengganti key setelah keputusan ditandatangani.
Output wajib kosong dan di luar Git; direktori akhir boleh belum ada. Tidak ada overwrite.
CLI hanya menampilkan sukses umum atau error umum tanpa nilai source dan stack trace.

Tanpa `--review`, output adalah manifest/checksum, rencana identitas, laporan integritas,
checklist API, dan **preflight read-only**. Tidak ada source-data DML. Laporan privat
memuat mapping source/target ID, provenance HMAC tiap row, HMAC key asli/surrogate,
count, dependensi, blocker, dan temuan schema/collation. Laporan tidak memuat password,
email, raw API key, URL lengkap, query token URL, atau konten tenant. ID/fingerprint tetap
informasi sensitif: jangan commit output ataupun evidence. Failure membuat exit code 1.

## Identitas dan dua skenario

**A: empty target fidelity.** Default tanpa config. Semua reservasi target harus kosong.
Memeriksa representasi record, bukan keamanan cutover target yang sudah berisi data.

**B: protected existing identity.** Bootstrap sintetis dibuat terpisah:

```bash
node backend/migration/package.cjs --bootstrap \
  --output=/private/universe-migration/bootstrap-b
```

Berkas bootstrap tidak bergabung dengan paket source. Isinya hanya user fiktif ID 1,
email `admin@rehearsal.invalid`, role global `super_admin`, dan bcrypt cost 12 dari
password acak 256-bit yang langsung dibuang. Tidak ada password login yang diberikan;
role sintetis ini bukan email Super Admin aplikasi sebenarnya. Import manual hanya
setelah approval terpisah dan semua 28 tabel terbukti kosong. Tidak ada reset/DDL.

Setelah import bootstrap manual **oleh administrator**, gunakan `target-reservations.json`
sebagai properti `target` dalam config lokal, misalnya:

```json
{
  "scenario": "B",
  "target": {
    "users": [{"id": 1, "email": "admin@rehearsal.invalid"}],
    "user_global_roles": [{"user_id": 1, "role": "super_admin"}]
  },
  "mappings": [],
  "decisions": [],
  "observations": []
}
```

Pass `--config=/private/universe-migration/config-b.json`. Config wajib private JSON.
Ekspor reservasi ID **semua record target yang sudah ada**, termasuk target tenant,
subdomain, dan fingerprint identitas/API key bila relevan. Credential-bearing inventory
ditolak. Target email dinormalisasi ke HMAC dengan key lokal sebelum dibandingkan.
Skenario B mensyaratkan user target dan role global. ID source yang terpakai dialokasikan
di atas ID maksimum source/target; semua FK/membership/API-key ownership di-remap.
Tidak ada merge berdasarkan email dan tidak ada INSERT IGNORE.

Jika benar-benar memetakan source user ke target Super Admin, gunakan override
`mode: verified_existing`, `sourceTenantId`, `credentialPolicy: preserve_target`,
`globalRolePolicy: no_import`. Diperlukan keputusan `verified_existing_identity`
sesuai `decisions.js` dan `fileEvidence.js`: checksum file, keputusan di dalam file,
`checks` dengan conclusion passed/observations, waktu review, source/target snapshot
fingerprint, email HMAC kedua sisi, collation, target ID dan membership aktif harus cocok.
Tidak ada boolean bypass. Lihat test sintetis `offlinePackage.test.cjs` untuk struktur.
User yang terverifikasi tidak di-INSERT/UPDATE; target credentials dan global role tetap.

Tenant placeholder dipertahankan. Settings yang tidak ada **tidak dibuat**. Seluruh
19 tabel dipetakan tanpa exclusion otomatis. Post Article/Event tenant 5 dengan slug
sama tidak diubah: keputusan `cross_template_published` terikat snapshot wajib lulus
verifier lama. Ambiguitas detail API membutuhkan observasi dan keputusan terpisah
`legacy_api_ambiguity`. Konflik published pada template yang sama selalu blocker.

## Review lokal sebelum source DML bisa dibuat

Jalankan planner dahulu, baca `migration-identity-plan.json`, selesaikan blocker dan
buat ulang plan setelah input/keputusan berubah. Jangan mengedit fingerprint laporan.

Buat evidence JSON privat untuk **setiap** item `requiredReviews`. Setiap file harus
memuat `check` (nama item), `planFingerprint`, `administratorReviewStatus: approved`,
`reviewedAt` timestamp ISO, serta hasil pemeriksaan substantif administrator. Buat
review dossier terpisah:

```json
{
  "version": 1,
  "database": "uniin_universe_reh",
  "scenario": "A",
  "planFingerprint": "<dari plan>",
  "administratorReviewStatus": "approved",
  "reviewedAt": "<waktu ISO review sebenarnya>",
  "approvalReference": "<referensi persetujuan lokal>",
  "checks": {
    "consistent_export": {
      "status": "passed",
      "evidenceFile": "/private/universe-migration/evidence/export.json",
      "evidenceSha256": "<checksum file>"
    }
  }
}
```

Lengkapi seluruh nama requiredReviews dalam plan. Evidence harus persetujuan manusia,
bukan file otomatis yang memberi passed tanpa pengamatan. Checksum mengikat isi, bukan
tanda tangan kriptografis maupun pembuktian bahwa klaim administrator benar.

Review `schema_mapping` wajib menjelaskan **setiap** temuan compareSchemas foundation
sebelumnya (ordinal kolom, FK action yang metadata legacy belum ketahui, redundant FK,
perbedaan collation). Named column INSERT tidak bergantung urutan ordinal. Dossier tidak
mengubah hasil comparer; keputusan existing identity/slug tetap diverifikasi tersendiri.
`target_collation_unique_keys` harus menilai seluruh indeks unik dan konflik target dengan
aturan collation MySQL sebenarnya, bukan mengasumsikan JavaScript lowercase sama dengan
utf8mb4_unicode_ci. Metadata collation key harus berasal dari bukti lokal administrator;
planner ini hanya melakukan deteksi awal dan **tidak mengemulasikan collation MySQL**.

`content_json_roundtrip`/`media_references` harus memeriksa embedded database IDs di
LONGTEXT, Settings, plugin config, dan layout. Tool sengaja tidak mengubah nested JSON
secara lossy. Jika ID yang berubah dirujuk secara embedded dan tidak bisa direpresentasikan
aman tanpa rewrite, **jangan approve**: butuh transformasi khusus di fase coding berikutnya.
Inventaris URL hanya kandidat provider/jenis, bukan bukti aset tersedia atau lengkapnya
referensi semantik. CDN ID, URL relatif, Drive/Cloudinary, CTA/navigation perlu review manusia.

`password_hash_compatibility` harus membuktikan format source diterima bcrypt aplikasi.
Row user baru mempertahankan hash source dalam SQL privat; tidak dicetak pada laporan.
Jangan memakai real hash untuk fixture/committed bootstrap atau membuka login rehearsal.
Jika kebijakan isolasi tidak mengizinkan hash source di rehearsal, **jangan approve**;
siapkan snapshot rehearsal yang sudah disanitasi dan diotorisasi secara terpisah.
API key selalu surrogate deterministik `reh_...`; original key hanya dibaca lokal untuk
HMAC, tidak dimasukkan SQL. Mode preservasi production key tidak disediakan di fase ini.

Setelah semua bukti lengkap, buat direktori output baru:

```bash
node backend/migration/package.cjs \
  --input=/private/universe-migration/input \
  --output=/private/universe-migration/reviewed-a \
  --key=/private/universe-migration/key \
  --review=/private/universe-migration/review-a.json --batch-size=100
```

Gunakan config yang sama jika Skenario B/keputusan dipakai. Plan fingerprint harus identik.
Satu perubahan snapshot, key, target, keputusan, skenario, evidence atau batch-size mengubah
rencana/batch terkait. SQL terdiri dari stage berurutan (maksimum 500 row/file, default
100) dan postflight read-only yang dipecah per batas statement. File SQL >8 MiB ditolak;
kurangi batch-size untuk stage besar. Single row terlalu besar membutuhkan pengembangan
lebih lanjut. Tidak pernah memotong konten demi memenuhi batas ukuran.

## Prosedur manual berikutnya — belum dilaksanakan di fase ini

1. Administrator verifikasi isolasi mengikuti Foundation 5B
   `REHEARSAL_ISOLATION_CHECKLIST.md`, `03_rehearsal_verify.sql`, dan
   `04_rehearsal_empty_data_check.sql`. Database terpilih harus `uniin_universe_reh`,
   tidak terhubung aplikasi, domain, tenant website, worker, SMTP/webhook, atau CDN writes.
2. Simpan backup rehearsal dan bukti privilege boundary; tetapkan operator dan restore plan.
   Tidak perlu dan jangan recreate/reset skema yang sudah direview. Untuk B, review lalu
   import bootstrap terpisah dan ekspor reservasi setelahnya. Jangan mulai aplikasi backend.
3. Verifikasi checksum manifest lokal. Jalankan preflight **secara manual** di phpMyAdmin;
   cocokkan seluruh count dengan reservasi dan pastikan schema/constraints sesuai bukti.
4. Review SQL stage termasuk hex-encoded konten (decode lokal untuk review, bukan stdout
   publik). Semua identifier database fully qualified. Unicode, NULL, timestamp dan string
   dipertahankan; hex string tidak bergantung quote/backslash SQL mode. Tidak ada ALTER,
   CREATE, DROP, TRUNCATE, DELETE, UPDATE, FK disable atau INSERT IGNORE.
5. Import satu stage dalam urutan nama file, tanpa concurrent writes. **Matikan fitur
   continue-on-error** pada importer. Nilai guard harus READY; STOP berarti jangan lanjut.
   Per-stage transaction memakai expected counts, absent target IDs, batch marker dan
   predecessor untuk mendeteksi partial/repeated/stale imports. Marker `prepared` baru
   dibuat bila row exact-byte cocok; status itu bukan validasi atau applied/cutover.
6. Periksa hasil setiap stage: transaksi berhasil, count/deterministic stage batch ID sesuai,
   marker predecessor ada. Jangan menafsirkan exit nol dari UI yang mengabaikan error
   sebagai sukses. SQL guard adalah pemeriksaan lokal, bukan executor fail-stop yang bisa
   menjamin perilaku semua client. Kegagalan statement/connection wajib dihentikan manusia.
7. Jalankan seluruh postflight read-only. Semua expected count harus cocok, exact bytes/NULL
   harus benar, orphan_count harus nol. Perbandingan kolom mencakup timestamp, tenant/user
   ownership, role membership, slug/template/status, konten JSON, Settings, dan platform data.
   Bandingkan secara privat hash/password/global role target sebelum/sesudah; tidak ada
   UPDATE pada protected user. Cocokkan HMAC original-key secara lokal; SQL memakai surrogate.
   Review daftar migration_batches/stage markers; jangan otomatis memberi status applied.
8. Lengkapi checklist API (termasuk Sentra Kreasi detail ambiguity) sebagai rencana uji fase
   berikut. Tidak ada backend rehearsal/public integration test dijalankan di fase 5C.1.
9. Jika ada discrepancy, simpan evidence privat dan STOP. Tidak ada auto-repair, resume,
   penghapusan, atau reset otomatis. Administrator memulihkan backup **hanya rehearsal**
   memakai `RESTORE_AND_RESET_PLAN.md` 5B, meninjau sebab, mengambil ulang reservasi,
   lalu membuat/review paket baru. Jangan mengubah marker agar repeat guard lolos.
10. Rehearsal A dan B dilaporkan terpisah. Keberhasilan A tidak membuktikan protected-target
    cutover aman. Data/API/collation/availability/isolation yang belum diuji tetap blocker.

## Pengujian dan batas klaim

`npm test --prefix backend` mencakup snapshot parsial/malformed, permission/path privacy,
checksum/count, identity collision/verified mapping, tenant ownership/FK/folder order,
konten Unicode/JSON, missing Settings, collation/slug review, media, secret redaction,
SQL encoding, duplicate/partial guards, deterministic output, bootstrap bcrypt serta
ketiadaan runtime DB/network imports. Seluruh fixture sintetis; generated hash/SQL/test
output berada di temporary directory privat dan dihapus setelah test.
`npm run build` menguji frontend. SQL tidak dieksekusi bahkan terhadap database lokal;
validitas import sebenarnya, collation dan postflight memerlukan rehearsal manual
berikutnya. Jangan menyatakan readiness production atau hasil migrasi dari unit test.
