# Pemulihan kata sandi di Kroombox (`main`)

Aplikasi dapat di-deploy sebelum migrasi: login, registrasi, dan sesi lama tetap berfungsi. Endpoint pemulihan mengembalikan HTTP 503 hingga kedua tabel tersedia. Migrasi **tidak** berjalan otomatis saat backend start.

1. Pastikan Anda sedang memakai database **development Kroombox**, bukan Aiven/`V2`. Buat cadangan database Kroombox.
2. Di phpMyAdmin Kroombox, pilih database CMS, buka tab SQL, lalu jalankan seluruh isi [`backend/scripts/passwordRecovery.sql`](../scripts/passwordRecovery.sql). Script memakai `CREATE TABLE IF NOT EXISTS`, tidak menyunting baris pengguna atau tenant.
3. Pastikan tabel `account_auth_state` dan `password_reset_tokens` muncul dengan struktur dan foreign key yang benar. Jangan mengimpor script ini ke Aiven.
4. Pastikan backend Kroombox memakai `FRONTEND_URL=https://universe.uniinside.net` (tanpa path tambahan), serta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, dan `EMAIL_FROM` yang terverifikasi di Brevo development. Tautan pemulihan memakai origin dari `FRONTEND_URL`; port 2525 menggunakan STARTTLS. Bila variabel sudah benar, tidak perlu menambah variabel baru.
5. Uji dengan **akun development sintetis**: minta tautan melalui halaman login, buka email, ganti kata sandi, pastikan tautan tidak dapat dipakai lagi dan token login sebelumnya ditolak. Periksa juga bahwa email tidak dikenal mendapat pesan umum yang sama. Jangan pakai alamat tenant produksi untuk uji.
6. Untuk Super Admin, gunakan tautan **verifikasi kode email** dari halaman Lupa Kata Sandi. Jalur tersebut memakai endpoint khusus yang sudah ada; tautan reset biasa tidak dapat memulihkan Super Admin.

Pembatasan permintaan per IP disimpan di memori proses Node. Jika Kroombox memakai beberapa instance backend, ganti penyimpan pembatasan dengan shared store sebelum memperbesar skala. Cooldown 60 detik per akun ditopang tabel MySQL dan tetap berlaku lintas instance. Pengiriman SMTP nyata tidak diuji oleh suite otomatis; tes memakai mailer tiruan dan tidak mengirim email eksternal.

Token dikirim di fragmen tautan (`#token=...`) agar tidak ikut dalam permintaan atau log akses frontend. Halaman reset segera menghapus fragmen dari bilah alamat. Tautan berbentuk query lama juga dapat dibaca untuk kompatibilitas, kemudian dibersihkan.
