import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, ComparisonTable, PricingCards, Faq, FinalCta } from "@/components/landing/sections";

/**
 * Variant BM-3 — "Kes Komersial" (sudut ROI).
 *
 * Versi Bahasa Melayu bagi varian "roi". Mengetengahkan wang dan memaparkan
 * pakej secara langsung — telus harga, sesuai sebagai halaman trafik berbayar
 * dan sebagai ujian A/B sama ada memaparkan harga lebih awal meningkatkan
 * penukaran.
 */

export default function BmHargaLanding() {
  return (
    <LandingShell
      variant="bm-harga"
      nav={[
        { href: "#kiraan", label: "Kiraannya" },
        { href: "#pakej", label: "Pakej" },
        { href: "#soalan", label: "Soalan Lazim" },
      ]}
    >
      <Hero
        eyebrow="Kes komersialnya"
        title="Satu tender membayar"
        highlight="setahun PERSIS."
        subtitle="Menganalisis tender bersaiz sederhana secara manual memakan masa berhari-hari tenaga mahir dan lebih kurang RM 800–2,000 kos buruh. PERSIS melakukannya dalam beberapa minit — dan mengesan kesilapan harga yang diam-diam menelan kos jauh lebih tinggi daripada langganan."
        primary={{ href: "#pakej", label: "Lihat pakejnya" }}
        secondary={{ href: "#kiraan", label: "Semak kiraannya" }}
        note="Harga pakej ditunjukkan di bawah. Angka untuk usaha manual ialah anggaran ilustratif bagi tender bersaiz sederhana."
      />

      <StatBand
        stats={[
          { value: "RM 800–2,000", label: "Buruh manual setiap tender" },
          { value: "Dari RM 299", label: "Pakej PERSIS" },
          { value: "1 kredit = RM 1", label: "Tiada pembaziran" },
          { value: "Tidak pernah", label: "Kredit luput" },
        ]}
      />

      <ComparisonTable
        id="kiraan"
        title="Apa kos satu tender kepada anda hari ini"
        subtitle="Cara manual terasa percuma kerana kosnya tersebar merentasi gaji dan waktu malam. Apabila diperincikan, ia tidak kelihatan percuma."
        rows={[
          {
            work: "Membaca & mengekstrak keperluan",
            before: "RM 800–2,000 masa QS atau kerani kanan setiap tender",
            after: "Beberapa minit pemprosesan",
          },
          {
            work: "Membina BOQ",
            before: "1–2 hari transkripsi, dengan kesilapan taip untuk dikesan kemudian",
            after: "Dijana secara automatik daripada dokumen",
          },
          {
            work: "Menentukan harga setiap item",
            before: "Berjam-jam panggilan pembekal dan kadar yang separuh diingati",
            after: "Pustaka harga dan penanda aras anda digunakan dalam beberapa saat",
          },
          {
            work: "Satu item yang tersilap harga",
            before: "Boleh melebihi keuntungan keseluruhan kerja",
            after: "Dibenderakan untuk semakan sebelum anda menghantar",
          },
          {
            work: "Tender yang tidak pernah anda bida",
            before: "Kos peluang yang tidak muncul pada sebarang laporan",
            after: "Analisis dalam beberapa minit dan putuskan atas pilihan",
          },
        ]}
        footnote="PERSIS mengenakan bayaran mengikut tender yang diproses, bukan mengikut pengguna. Anda mengesahkan anggaran kredit sebelum sebarang kerja bermula."
        cta={{ href: "#pakej", label: "Pilih satu pakej" }}
      />

      <PricingCards
        id="pakej"
        title="Pakej yang mudah difahami"
        subtitle="Beli kredit, proses tender. Tiada lesen mengikut pengguna dan tiada ikatan tahunan."
        footnote="1 kredit = RM 1. Kredit tidak pernah luput dan hanya digunakan apabila anda memproses tender — anda melihat dan mengesahkan anggaran kosnya dahulu. Langganan 30 hari diperlukan untuk memuat naik dan memproses tender."
      />

      <Faq
        id="soalan"
        title="Soalan yang kontraktor tanya sebelum mendaftar"
        items={[
          {
            q: "Adakah kredit luput?",
            a: "Tidak. Kredit tidak pernah luput dan hanya digunakan apabila anda memproses tender. Anda akan ditunjukkan anggaran kos kredit dan mesti mengesahkannya sebelum apa-apa ditolak.",
          },
          {
            q: "Bagaimana kos pemprosesan ditentukan?",
            a: "Ia berdasarkan saiz dan kerumitan dokumen, dan ditunjukkan kepada anda sebagai anggaran kredit sebelum anda mengesahkannya. Jumlahnya tetap pada ketika itu — tiada caj tambahan selepasnya, walaupun saluran kerja menggunakan lebih banyak kapasiti AI daripada anggaran.",
          },
          {
            q: "Bolehkan saya mengimbas tender bercetak?",
            a: "Boleh. Pada telefon atau tablet, gunakan Scan Tender untuk merakam halaman mengikut turutan. PERSIS menghimpunkannya menjadi satu PDF dan menjalankan OCR secara automatik, jadi tender bercetak berfungsi sebaik tender digital.",
          },
          {
            q: "Adakah data harga saya dapat dilihat kontraktor lain?",
            a: "Tidak. Pustaka harga, projek dan dokumen anda adalah peribadi kepada akaun anda. Setiap permintaan berskala projek disemak terhadap pemilikan, jadi pengguna lain tidak dapat mencapai data anda dengan meneka ID.",
          },
          {
            q: "Bagaimana jika pengekstrakan tidak sempurna?",
            a: "Item yang tidak dapat dihargakan dengan yakin oleh PERSIS dibenderakan untuk semakan, bukan diagak. Anda boleh meminda sebarang harga sendiri, dan setiap pindaan ditulis ke log audit bersama alasannya.",
          },
          {
            q: "Perlukah saya terikat setahun?",
            a: "Tidak. Setiap pembelian mengaktifkan langganan 30 hari bersama kredit anda. Kredit kekal milik anda, dan anda boleh menambah nilai bila-bila masa ada tender untuk diproses.",
          },
        ]}
      />

      <FinalCta
        title="Cubanya pada tender sebenar"
        subtitle="Cipta akaun, proses satu dokumen anda sendiri, dan nilaikannya berbanding jam yang sepatutnya anda habiskan."
        primary={{ href: "/register", label: "Cipta akaun" }}
        secondary={{ href: "/login", label: "Log masuk" }}
      />
    </LandingShell>
  );
}
