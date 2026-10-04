import { AlertTriangle, ShieldCheck, Ruler, Search, History, TrendingUp } from "lucide-react";
import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, FeatureGrid, ComparisonTable, FinalCta } from "@/components/landing/sections";

/**
 * Variant BM-2 — "Lindungi Margin Anda" (sudut risiko / ketepatan).
 *
 * Versi Bahasa Melayu bagi varian "risk". Mengetengahkan kos kesilapan harga
 * dan perlindungan yang mengesannya: bendera semakan, asal-usul harga dan
 * jejak audit.
 */

export default function BmMarginLanding() {
  return (
    <LandingShell
      variant="bm-margin"
      nav={[
        { href: "#perlindungan", label: "Perlindungan" },
        { href: "#kos", label: "Kos kesilapan" },
        { href: "#banding", label: "Perbandingan" },
      ]}
    >
      <Hero
        eyebrow="Perlindungan margin untuk penentuan harga tender"
        title="Satu kadar yang salah boleh"
        highlight="menghapuskan margin keseluruhan kerja."
        subtitle="Satu item yang tersilap harga pada tender RM 500,000 boleh menghapuskan lebih daripada keuntungan keseluruhan kerja. PERSIS bukan sekadar menentukan harga tender anda — ia memberitahu di mana ia kurang pasti, dan dari mana setiap angka datang."
        primary={{ href: "/register", label: "Lindungi tender saya" }}
        secondary={{ href: "#perlindungan", label: "Lihat perlindungannya" }}
      />

      <StatBand
        id="kos"
        stats={[
          { value: "5", label: "Jenis bendera mengesan harga lemah" },
          { value: "±25%", label: "Sisihan penanda aras dibenderakan" },
          { value: "100%", label: "Pindaan ditulis ke audit" },
          { value: "Setiap kadar", label: "Membawa sumbernya" },
        ]}
      />

      <FeatureGrid
        id="perlindungan"
        title="Perlindungan yang memastikan angka itu tepat"
        subtitle="PERSIS tidak pernah mereka-reka harga. Apabila ia tidak dapat mempertahankan sesuatu angka, ia berkata demikian dan memulangkan keputusan kepada anda."
        items={[
          {
            icon: AlertTriangle,
            title: "Harga yang hilang dibenderakan",
            desc: "Item tanpa padanan dalam pustaka harga anda atau penanda aras dilaporkan sebagai hilang — tidak pernah diam-diam dihargakan kosong.",
          },
          {
            icon: TrendingUp,
            title: "Kadar menyimpang diketengahkan",
            desc: "Sebarang kadar yang menyimpang jauh daripada harga rujukan dibenderakan untuk semakan kedua sebelum ia sampai ke penyerahan anda.",
          },
          {
            icon: Search,
            title: "Padanan lemah ditandakan",
            desc: "Apabila sesuatu perihalan hanya sebatas padanan longgar dengan item rujukan, PERSIS memberitahu keyakinannya rendah supaya anda boleh mengesahkannya.",
          },
          {
            icon: Ruler,
            title: "Ketidakpadanan unit dikesan",
            desc: "Jika unit tidak dapat diselaraskan antara tender dan harga rujukan, anda mengetahuinya semasa ia masih murah untuk diperbetulkan.",
          },
          {
            icon: ShieldCheck,
            title: "Setiap harga ada asal-usulnya",
            desc: "Pustaka kontraktor, penanda aras kerajaan, strategi hibrid, anggaran AI atau pindaan anda sendiri — sumbernya kekal bersama angka itu.",
          },
          {
            icon: History,
            title: "Jejak audit penuh",
            desc: "Setiap muat naik, pengekstrakan, pindaan dan pembayaran direkodkan. Anda sentiasa dapat menjawab 'dari mana angka ini datang?'",
          },
        ]}
      />

      <ComparisonTable
        id="banding"
        title="Dari mana sebenarnya kesilapan harga datang"
        subtitle="Kebanyakan kadar yang tidak baik bukanlah pertimbangan yang lemah — ia adalah kesilapan transkripsi, rujukan lapuk dan item tidak sepadan yang tidak disedari sesiapa."
        rows={[
          {
            work: "Item yang tidak dihargakan",
            before: "Kadar kosong atau sifar menyelinap masuk ke penyerahan tanpa disedari",
            after: "Dibenderakan sebagai hilang dan disenaraikan untuk semakan",
          },
          {
            work: "Kadar yang lari daripada pasaran",
            before: "Dikesan selepas perolehan, apabila margin sudah pun hilang",
            after: "Sisihan penanda aras dibenderakan sebelum anda menghantar",
          },
          {
            work: "Item yang salah dipadankan",
            before: "Perihalan yang kelihatan serupa mendapat harga yang serupa",
            after: "Padanan keyakinan rendah ditandakan supaya anda boleh mengesahkannya",
          },
          {
            work: "Kekeliruan kuantiti atau unit",
            before: "Ditemui semasa pelaksanaan, selepas kontrak ditandatangani",
            after: "Ketidakpadanan unit dilaporkan semasa semakan",
          },
          {
            work: "Menerangkan sesuatu angka kemudian",
            before: "Tiada siapa ingat dari hamparan atau panggilan telefon mana ia datang",
            after: "Setiap kadar dan pindaan direkodkan bersama sumbernya",
          },
        ]}
        footnote="PERSIS membantu — anda yang memutuskan. Semakan manusia adalah matlamatnya, bukan kegagalan sistem."
        cta={{ href: "/register", label: "Cipta akaun" }}
      />

      <FinalCta
        title="Hargakan tender anda seolah-olah margin anda bergantung padanya."
        subtitle="Kerana ia memang begitu. Semak pengecualiannya, bukannya menyemak semula setiap baris dengan tangan."
        primary={{ href: "/register", label: "Mula sekarang" }}
        secondary={{ href: "/login", label: "Log masuk" }}
      />
    </LandingShell>
  );
}
