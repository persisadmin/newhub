import { Cpu, Table2, LineChart, Flag, FileCheck, Upload, Clock, ShieldCheck } from "lucide-react";
import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, PipelineStrip, NumberedSteps, FeatureGrid, ComparisonTable, FinalCta } from "@/components/landing/sections";

/**
 * Variant BM-1 — "Bida Lebih Banyak Tender" (sudut kelajuan / kapasiti).
 *
 * Versi Bahasa Melayu bagi varian "speed". Hujahnya: masa analisis, bukan
 * kemahiran menentukan harga, yang menghadkan berapa banyak tender seseorang
 * kontraktor mampu bida.
 */

const PIPELINE = [
  { icon: Upload, label: "Muat Naik Tender" },
  { icon: Cpu, label: "Pengekstrakan AI" },
  { icon: Table2, label: "BOQ Berstruktur" },
  { icon: LineChart, label: "Risikan Harga" },
  { icon: Flag, label: "Bendera Semakan" },
  { icon: FileCheck, label: "Tender Sedia" },
];

export default function BmLajuLanding() {
  return (
    <LandingShell
      variant="bm-laju"
      nav={[
        { href: "#caranya", label: "Cara ia berfungsi" },
        { href: "#hasil", label: "Hasil" },
        { href: "#banding", label: "Perbandingan" },
      ]}
    >
      <Hero
        eyebrow="Untuk kontraktor yang membida setiap minggu"
        title="Analisis dalam"
        highlight="beberapa minit, bukan berhari-hari."
        subtitle="Muat naik tender pada waktu pagi dan dapatkan Bill of Quantities (BOQ) berharga yang sedia untuk disemak sebelum tengah hari. Kekangan sebenar bukanlah pertimbangan harga anda — tetapi menaip semula, panggilan telefon dan hamparan elektronik."
        primary={{ href: "/register", label: "Analisis satu tender" }}
        secondary={{ href: "#caranya", label: "Lihat cara ia berfungsi" }}
      >
        <PipelineStrip steps={PIPELINE} />
      </Hero>

      <StatBand
        id="hasil"
        stats={[
          { value: "Minit", label: "Masa analisis biasa" },
          { value: "3×", label: "Lebih banyak tender disemak" },
          { value: "0", label: "Taip semula manual" },
          { value: "100%", label: "Kadar menunjukkan sumbernya" },
        ]}
      />

      <NumberedSteps
        id="caranya"
        title="Tiga langkah daripada dokumen kepada keputusan"
        subtitle="Anda kekal mengawal keputusan komersial. PERSIS membuang kerja perkeranian di hadapannya."
        steps={[
          {
            title: "Muat naik tender",
            desc: "PDF, Word atau teks biasa — atau imbas salinan bercetak menggunakan telefon anda. Halaman yang diimbas akan melalui OCR secara automatik, jadi tender bercetak berfungsi sebaik tender digital.",
          },
          {
            title: "Semak hasil pengekstrakan",
            desc: "PERSIS menyusun Bill of Quantities dan menentukan harga setiap baris daripada pustaka harga anda sendiri serta rujukan penanda aras. Apa-apa yang kurang diyakini akan dibenderakan, bukan diagak.",
          },
          {
            title: "Hantar dengan yakin",
            desc: "Laraskan apa-apa yang memerlukan semakan manusia, kemudian eksport. Jadual harga, penyata kaedah, spesifikasi dan senarai semak dijana sebagai satu pakej penyerahan lengkap.",
          },
        ]}
      />

      <FeatureGrid
        title="Dibina untuk membuang bahagian yang perlahan"
        subtitle="Setiap langkah yang dahulunya mengambil masa sehari tenaga mahir kini diautomasikan — dengan titik semakan yang kekal jelas."
        items={[
          { icon: Cpu, title: "Pengekstrakan automatik", desc: "Nombor tender, agensi, tarikh tutup, skop dan keperluan dibaca terus daripada dokumen." },
          { icon: Table2, title: "BOQ berstruktur", desc: "Bahan, kerja dan buruh disusun ke dalam Bill of Quantities yang kemas, dengan mengekalkan ayat asal tender." },
          { icon: LineChart, title: "Penentuan harga serta-merta", desc: "Setiap item dipadankan dengan pustaka harga kontraktor anda dan rujukan penanda aras, dengan strategi hibrid di mana sesuai." },
          { icon: Clock, title: "Kemajuan langsung", desc: "Pantau setiap peringkat saluran kerja semasa ia berjalan. Tiada kotak hitam, tiada menunggu e-mel." },
          { icon: ShieldCheck, title: "Jejak audit", desc: "Setiap muat naik, pengekstrakan dan pindaan direkodkan, supaya anda dapat mengesan sebarang angka kembali kepada sumbernya." },
          { icon: FileCheck, title: "Dokumen dijana", desc: "Buku kerja BOQ berharga, penyata kaedah, spesifikasi dan senarai semak — sedia untuk dimuat turun dan dihantar." },
        ]}
      />

      <ComparisonTable
        id="banding"
        title="Ke mana sebenarnya masa seminggu anda pergi"
        subtitle="Anggaran ilustratif untuk tender bersaiz sederhana. Angka manual ialah jam yang pasukan anda sudah pun luangkan."
        rows={[
          {
            work: "Membaca & mengekstrak keperluan",
            before: "2–4 hari seorang QS atau kerani kanan membaca, menanda dan menaip semula",
            after: "Beberapa minit, diekstrak secara automatik",
          },
          {
            work: "Membina BOQ",
            before: "Transkripsi manual ke dalam hamparan — setiap baris berisiko tersilap taip",
            after: "Berstruktur terus daripada dokumen, ayat asal dikekalkan",
          },
          {
            work: "Menentukan harga setiap item",
            before: "Panggilan telefon kepada pembekal, hamparan lama dan agakan",
            after: "Pustaka harga dan penanda aras anda digunakan dalam beberapa saat",
          },
          {
            work: "Menyediakan pakej penyerahan",
            before: "Membina semula dokumen yang sama daripada awal untuk setiap tender",
            after: "Dijana untuk anda: BOQ, jadual harga, penyata kaedah, senarai semak",
          },
          {
            work: "Tender dibida setiap bulan",
            before: "Dihadkan oleh berapa banyak dokumen yang pasukan anda mampu proses",
            after: "Dihadkan hanya oleh tender yang anda pilih untuk kejar",
          },
        ]}
        footnote="Apabila analisis mengambil masa berhari-hari, anda terlepas tender yang sepatutnya anda menangi. Kos itu tidak muncul pada sebarang invois — itulah sebabnya ia tidak disedari."
        cta={{ href: "/register", label: "Cipta akaun" }}
      />

      <FinalCta
        title="Berhenti memilih antara teliti dan pantas."
        subtitle="Analisis setiap tender yang tiba di meja anda, dan tolak yang tidak baik atas pilihan — bukan kerana kekurangan kapasiti."
        primary={{ href: "/register", label: "Mula sekarang" }}
        secondary={{ href: "/login", label: "Log masuk" }}
      />
    </LandingShell>
  );
}
