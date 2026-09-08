import { PrismaClient, TreatmentCategory } from '@prisma/client';
import {
  RawExportItem,
  normalizePhone,
  cleanCustomerName,
  parsePatientAgeAndName,
  parseBookingDateTime,
  mapPatientTypeToCategory,
} from './enrich-export-helpers';

export const RAW_EXPORT_DATA: RawExportItem[] = [
  {
    "contact_id": "1",
    "customer_name": "Leliy Jambangan",
    "phone_number": "628113099991",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "Rabu, 08/07/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Ghazy",
    "treatments": [
      "Pijat Bayi"
    ],
    "address_info": "Jambangan, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan eksplisit dalam chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "1",
    "customer_name": "Leliy Jambangan",
    "phone_number": "628113099991",
    "order_index": 2,
    "order_date_chat": "2026-07-12",
    "booking_date": "2026-07-13",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Ghazy",
    "treatments": [
      "Pijat Bayi"
    ],
    "address_info": "Jambangan, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas ('besok pijat bayi jam 1 siang bisa?'), treatment mengikuti data order sebelumnya. Ada sebutan 'kelebihan 10rb' saat pembayaran follow-up 14/07.",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "25",
    "customer_name": "Amalia Ilmi Bubutan",
    "phone_number": "6285591704294",
    "order_index": 1,
    "order_date_chat": "2026-06-27",
    "booking_date": "2026-06-27",
    "booking_time": "Tidak diketahui",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Tidak diketahui"
    ],
    "address_info": "Bubutan, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Data sangat minim - hanya 1 bubble chat: BOT 'Iya bunda saya sudah didepan' (konfirmasi kedatangan treatment, menunjukkan booking sudah terjadi tapi detail tidak ada di riwayat chat)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "30",
    "customer_name": "Bunda Fierda, Wiyung Apart CBD",
    "phone_number": "62895635933640",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak dapat dipastikan (timestamp korup pada data ekspor)",
    "booking_time": "Tidak dapat dipastikan",
    "patient_type": "Moms",
    "patient_name": "",
    "treatments": [
      "Oksitosin Full Body Massage",
      "Breast Massage"
    ],
    "address_info": "Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 72000,
      "delivery_fee": 15000,
      "total_price": 87000
    },
    "order_status": "DEAL",
    "notes": "Timestamp semua bubble chat identik (17/08/2026 20:44) - kemungkinan besar artefak sinkronisasi data massal, tanggal chat/booking asli tidak dapat dipastikan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "30",
    "customer_name": "Bunda Fierda, Wiyung Apart CBD",
    "phone_number": "62895635933640",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak dapat dipastikan (timestamp korup)",
    "booking_time": "11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas: 'Sore mba pijat bayi pulih ceria + sinar moksa' -> deal 'Okedeh'. Timestamp korup.",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "31",
    "customer_name": "Bunda Mia, Karangtanjung",
    "phone_number": "6282140706880",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak dapat dipastikan (timestamp korup)",
    "booking_time": "09.30-10.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Pijat Bapil"
    ],
    "address_info": "Karangtanjung, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "31",
    "customer_name": "Bunda Mia, Karangtanjung",
    "phone_number": "6282140706880",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak dapat dipastikan (timestamp korup)",
    "booking_time": "11.00-11.30",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Pijat Bapil"
    ],
    "address_info": "Karangtanjung, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas ('treatment nya seperti kemarin'), harga tidak disebutkan ulang, kemungkinan sama dengan order 1 (Rp95.000)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "32",
    "customer_name": "Bunda Jeanetta, Kertajaya",
    "phone_number": "6281233285194",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Rabu, 12 Agustus 2026",
    "booking_time": "12.30-13.00",
    "patient_type": "Combination",
    "patient_name": "Owen (2 bulan) & Briell (3 tahun)",
    "treatments": [
      "Pijat Bayi Kids Ceria"
    ],
    "address_info": "Kertajaya, Surabaya",
    "pricing_details": {
      "treatment_fee": 130000,
      "delivery_fee": 25000,
      "total_price": 145000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; ada diskon promo 10rb",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "43",
    "customer_name": "firdahamidah, Petikan",
    "phone_number": "628816336788",
    "order_index": 1,
    "order_date_chat": "2026-07-05",
    "booking_date": "Selasa, 07/07/2026",
    "booking_time": "15.30",
    "patient_type": "Baby",
    "patient_name": "Dhafi (11 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Intan 5.1 No 57, Petiken",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 25000,
      "total_price": 75000
    },
    "order_status": "DEAL",
    "notes": "Sudah termasuk promo 10rb",
    "meta_matching_fields": {
      "city": "Gresik",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "46",
    "customer_name": "amel, Karang Pilang",
    "phone_number": "6288228029868",
    "order_index": 1,
    "order_date_chat": "2026-07-07",
    "booking_date": "Rabu, 08/07/2026",
    "booking_time": "08.00",
    "patient_type": "Baby",
    "patient_name": "Zareen (4 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Lapangan Fasum RW02 Karangpilang RT3/RW02, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "Form asli tertulis 'Rabu/7-07-2026' - kemungkinan typo customer (chat terjadi malam 07/07 untuk booking besok)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "47",
    "customer_name": "Gita Tyas, Ngagel",
    "phone_number": "6289688887616",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "Rabu, 08/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Nami (32 hari)",
    "treatments": [
      "Cukur",
      "Pijat Bayi Therapy"
    ],
    "address_info": "Jl Ngagel Dadi 1A No.7, Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 25000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "Add-on oksitosin sempat ditawarkan tapi ditolak customer (tidak ada babysitter)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "56",
    "customer_name": "Bunda Dita, Kalijudan",
    "phone_number": "6282244400964",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Senin, 10 Agustus 2026",
    "booking_time": "12.30-13.00",
    "patient_type": "Baby",
    "patient_name": "Azkiya (2 bulan 20 hari)",
    "treatments": [
      "Pijat Bayi"
    ],
    "address_info": "Kalijudan Taruna V No 26A, Mulyorejo, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 20000,
      "total_price": 80000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; pembayaran dikonfirmasi via transfer",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "61",
    "customer_name": "Bunda Cynthia, Buduran",
    "phone_number": "6287757017472",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Senin, 10 Agustus 2026",
    "booking_time": "17.00-17.30",
    "patient_type": "Baby",
    "patient_name": "Eleanora (17 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Banjarmukti Residence G-09, Buduran, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 25000,
      "total_price": 75000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "62",
    "customer_name": "Bunda Nia, Simomulyo",
    "phone_number": "6281296788992",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Jumat, 14 Agustus 2026",
    "booking_time": "13.30-14.00",
    "patient_type": "Kids",
    "patient_name": "Amira (3 tahun)",
    "treatments": [
      "Pijat Kids Ceria"
    ],
    "address_info": "Jl Simo Pomahan 7/49, Simomulyo Baru, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "64",
    "customer_name": "Deby, Karang Pilang",
    "phone_number": "6282230329202",
    "order_index": 1,
    "order_date_chat": "2026-07-09",
    "booking_date": "2026-07-10",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Khaira",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Karang Pilang, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 15000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "72",
    "customer_name": "Bunda Umi Salamah, Kepuh",
    "phone_number": "6282267677887",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Rabu, 29 Juli 2026",
    "booking_time": "16.30",
    "patient_type": "Baby",
    "patient_name": "Joyceline Arsabella Kinsley Rostova / Celine (1 tahun)",
    "treatments": [
      "Pijat Bayi Ceria (Relaksasi)"
    ],
    "address_info": "Kepuh Permai Jl Welirang Blok F-15, Kel. Kepuhkiriman, Kec. Waru, Kab. Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; total harga tidak disebutkan eksplisit di chat, ongkir free (<5km)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "76",
    "customer_name": "Bunda Nana, Ketintang",
    "phone_number": "6282140090072",
    "order_index": 1,
    "order_date_chat": "2026-07-17",
    "booking_date": "Selasa, 21/07/2026",
    "booking_time": "12.00",
    "patient_type": "Combination",
    "patient_name": "Azfar (1 bulan 10 hari)",
    "treatments": [
      "Selapan Bayi Ceria (Newborn)",
      "Paket Laktasi (Moms)"
    ],
    "address_info": "Ketintang Timur PTT 3 No 4O, Kec. Gayungan, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan eksplisit di chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "78",
    "customer_name": "Bunda Yuni, Wonosari",
    "phone_number": "6281999493778",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Sabtu (besok, timestamp korup)",
    "booking_time": "18.00",
    "patient_type": "Combination",
    "patient_name": "Alen & Alin",
    "treatments": [
      "Pijat Lahap/Pulih Ceria",
      "Pijat Moksa"
    ],
    "address_info": "Rumdis TNI AL Wonosari, Jl Bramasta A131/132",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "78",
    "customer_name": "Bunda Yuni, Wonosari",
    "phone_number": "6281999493778",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Sabtu (timestamp korup)",
    "booking_time": "10.00-10.30",
    "patient_type": "Combination",
    "patient_name": "Alen & Alin",
    "treatments": [
      "Pijat Lahap/Pulih Ceria",
      "Pijat Moksa"
    ],
    "address_info": "Rumdis TNI AL Wonosari, Jl Bramasta A131/132",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti sebelumnya'. Harga tidak disebutkan.",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "79",
    "customer_name": "Bunda Nurul Ifa, Sukodono",
    "phone_number": "6289668160522",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Kamis, 20 Agustus 2026",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "Ameera Calista Mecca (10 bulan)",
    "treatments": [
      "Pijat Lahap Juara"
    ],
    "address_info": "MCA Meuble, depan Balai Desa Suruh, Prumpun, Sukodono, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 75000,
      "delivery_fee": 25000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "Ditemukan melalui sampling verifikasi tambahan (bukan filter kata kunci utama)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "81",
    "customer_name": "Bunda Dynda, Pabean",
    "phone_number": "62895621166392",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Kamis, 13 Agustus 2026",
    "booking_time": "09.30-10.00",
    "patient_type": "Baby",
    "patient_name": "Dafa (4 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Jl Kyai Husein No 57, Pabean, Kec. Sedati, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 0,
      "total_price": 80000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; ongkir free (<5km)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "84",
    "customer_name": "Bunda Azalia, Gunung Anyar",
    "phone_number": "6285606474181",
    "order_index": 1,
    "order_date_chat": "2026-07-19",
    "booking_date": "Selasa, 21/07/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Baby",
    "patient_name": "Vrea (6 bulan)",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "New Green Hill Residence 2 EE-12, Gunung Anyar, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "87",
    "customer_name": "Nurmaya Dwi Fatmawati (Bunda Fatma), Mulyorejo",
    "phone_number": "6285645586423",
    "order_index": 1,
    "order_date_chat": "2026-07-09",
    "booking_date": "Jumat, 10/07/2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Baby",
    "patient_name": "Rafa (3 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Jl Babatan Labansari No 4, Mulyorejo, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "90",
    "customer_name": "Bunda Peny, Tambak Wedi",
    "phone_number": "6285708343551",
    "order_index": 1,
    "order_date_chat": "2026-07-22",
    "booking_date": "Kamis, 23/07/2026",
    "booking_time": "11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "Dhafin (10 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Jl Tambak Wedi Baru No 133, Kenjeran, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "96",
    "customer_name": "Bunda Riandika, Semolowaru",
    "phone_number": "6282137172877",
    "order_index": 1,
    "order_date_chat": "2026-07-22",
    "booking_date": "Kamis, 23/07/2026",
    "booking_time": "Same day",
    "patient_type": "Combination",
    "patient_name": "Chelsea (2 tahun 7 bulan) & Radeva (1 tahun)",
    "treatments": [
      "Pijat Bayi dan Kids Ceria"
    ],
    "address_info": "Jl Semolowaru Selatan 1 No 30, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan di chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "98",
    "customer_name": "Bunda Tere, Kutisari",
    "phone_number": "6281233138008",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Selasa, 18 Agustus 2026",
    "booking_time": "10.30-11.00",
    "patient_type": "Kids",
    "patient_name": "Keysha (2 tahun)",
    "treatments": [
      "Pijat Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Kutisari Indah Selatan 6 No.30, Tenggilis Mejoyo, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "121",
    "customer_name": "Fitria Febriani",
    "phone_number": "628563567095",
    "order_index": 1,
    "order_date_chat": "2026-07-09",
    "booking_date": "Sabtu, 11/07/2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Moms",
    "patient_name": "Fitria (hamil 38 minggu)",
    "treatments": [
      "Paket Bundling Pijat Perineum",
      "Breast Massage"
    ],
    "address_info": "Jl Bumiarjo Gang 7 No.14B, Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "123",
    "customer_name": "~Ivon",
    "phone_number": "6281357655602",
    "order_index": 1,
    "order_date_chat": "2026-07-23",
    "booking_date": "Jumat, 30/07/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Combination",
    "patient_name": "Jack (4 tahun) & Jayden (3 bulan)",
    "treatments": [
      "Pijat Lahap Juara",
      "Pijat Bayi Ceria"
    ],
    "address_info": "Margorejo Indah XV/C125, Wonocolo, Surabaya",
    "pricing_details": {
      "treatment_fee": 135000,
      "delivery_fee": 15000,
      "total_price": 145000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "125",
    "customer_name": "Bunda Erlin, Pakuwon City",
    "phone_number": "6281233311102",
    "order_index": 1,
    "order_date_chat": "2026-07-24",
    "booking_date": "Kamis, 31/07/2026",
    "booking_time": "14.00-15.00",
    "patient_type": "Baby",
    "patient_name": "Audrey (10 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Zimbali Costa Y2-25, Pakuwon City, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 20000,
      "total_price": 80000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "145",
    "customer_name": "Bunda Shofieai, Jojoran",
    "phone_number": "6283174984073",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Jumat, 14 Agustus 2026",
    "booking_time": "09.30-10.00",
    "patient_type": "Baby",
    "patient_name": "Aisyah (1 bulan)",
    "treatments": [
      "Paket Selapan (Cukur + Pijat Ceria)"
    ],
    "address_info": "Jojoran 5 Timur Blok C/10, Mojo, Gubeng, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "148",
    "customer_name": "Puput Nur, Waru",
    "phone_number": "6285730857455",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "Senin, 06/07/2026",
    "booking_time": "08.00-08.30",
    "patient_type": "Baby",
    "patient_name": "Aksa Bima Yudhistira (6 bulan)",
    "treatments": [
      "Pijat Bayi Ceria (Rileksasi)"
    ],
    "address_info": "Kepuh Permai, Kav. Baru Gg Buntu, Kepuh Kiriman, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 0,
      "total_price": 60000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "148",
    "customer_name": "Puput Nur, Waru",
    "phone_number": "6285730857455",
    "order_index": 2,
    "order_date_chat": "2026-07-23",
    "booking_date": "Minggu, 26/07/2026",
    "booking_time": "08.00",
    "patient_type": "Baby",
    "patient_name": "Aksa Bima Yudhistira (6 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Kepuh Permai, Kav. Baru Gg Buntu, Kepuh Kiriman, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 0,
      "total_price": 60000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas; harga dikonfirmasi 'masih sama'",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "149",
    "customer_name": "Bunda MUTIA A, Gunung Anyar",
    "phone_number": "6288994572210",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Selasa, 21 Juli 2026",
    "booking_time": "10.00-10.30",
    "patient_type": "Kids",
    "patient_name": "Hans Almuslim (14 bulan)",
    "treatments": [
      "Pijat Kids Relaksasi"
    ],
    "address_info": "Wisma Indah 2 K5 No 35, Gunung Anyar Tambak, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "150",
    "customer_name": "Bunda Dewi, Krian",
    "phone_number": "6285812791793",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak dapat dipastikan (besok, timestamp korup)",
    "booking_time": "09.30-10.00",
    "patient_type": "Baby",
    "patient_name": "Adek Almira",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Krian, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 25000,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti biasa'; timestamp korup",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "152",
    "customer_name": "Bunda Savira, Karangpilang Rusun",
    "phone_number": "6285646819945",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Sabtu (besok, timestamp korup)",
    "booking_time": "16.30-17.00",
    "patient_type": "Combination",
    "patient_name": "Bunda Savira & Adek Kenzio",
    "treatments": [
      "Pijat Pulih Ceria (Kenzio)",
      "Treatment Moms (tidak spesifik)"
    ],
    "address_info": "Karangpilang, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas; timestamp korup, harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "154",
    "customer_name": "Bunda Keke, Medokan Ayu",
    "phone_number": "6289698946288",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Rabu (timestamp korup)",
    "booking_time": "09.30-10.00",
    "patient_type": "Baby",
    "patient_name": "Ixander",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Medokan Ayu, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 15000,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas; timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "159",
    "customer_name": "Bunda Intan, Grogol Sby",
    "phone_number": "6285606450616",
    "order_index": 1,
    "order_date_chat": "2026-07-22",
    "booking_date": "Kamis, 23/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Azka (4 tahun 2 bulan) & Raisa (1 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria (Sinar Moksa)",
      "Pijat Kids Ceria"
    ],
    "address_info": "Jl Grogol III No 22, Genteng, Surabaya",
    "pricing_details": {
      "treatment_fee": 160000,
      "delivery_fee": 25000,
      "total_price": 170000
    },
    "order_status": "DEAL",
    "notes": "Form tertulis salah ketik '23 Juni' - konteks jelas menunjukkan 23/07/2026",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "160",
    "customer_name": "Bunda Dewy, Banyu Urip",
    "phone_number": "6289676108918",
    "order_index": 1,
    "order_date_chat": "2026-07-12",
    "booking_date": "2026-07-12",
    "booking_time": "14.30-15.00",
    "patient_type": "Baby",
    "patient_name": "Raisya (26 hari)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Girilaya II No.6, Kel. Banyu Urip, Kec. Sawahan, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Same-day booking",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "164",
    "customer_name": "Bunda Senda, Perum Makarya Binangun",
    "phone_number": "6281291226053",
    "order_index": 1,
    "order_date_chat": "2026-07-25",
    "booking_date": "Selasa, 28/07/2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Baby",
    "patient_name": "M. Arshaka (1,5 tahun)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Moksa"
    ],
    "address_info": "Jl Simpang Dewi Sartika Blok XA No.23, Perumahan Makarya Binangun, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 0,
      "total_price": 80000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "176",
    "customer_name": "Novi Candi",
    "phone_number": "6282311154677",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "2026-07-04",
    "booking_time": "~11.30-12.00",
    "patient_type": "Tidak diketahui",
    "patient_name": "",
    "treatments": [
      "Tidak diketahui"
    ],
    "address_info": "Candi, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama aja'. Data sangat minim - treatment/baby/harga tidak disebutkan eksplisit di excerpt ini",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "178",
    "customer_name": "Susi Setyowati, Gresik",
    "phone_number": "6285730657340",
    "order_index": 1,
    "order_date_chat": "2026-07-02",
    "booking_date": "2026-07-02",
    "booking_time": "Tidak diketahui",
    "patient_type": "Tidak diketahui",
    "patient_name": "",
    "treatments": [
      "Tidak diketahui"
    ],
    "address_info": "Gresik",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Data sangat minim - hanya 1 bubble: BOT 'Saya sudah didepan bunda'",
    "meta_matching_fields": {
      "city": "Gresik",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "183",
    "customer_name": "Bunda Fira, Kemayoran",
    "phone_number": "6281246975110",
    "order_index": 1,
    "order_date_chat": "2026-07-21",
    "booking_date": "Jumat, 31/07/2026",
    "booking_time": "09.30-10.00",
    "patient_type": "Combination",
    "patient_name": "Athar (9 bulan), Alana (5 tahun), Alma (3 tahun)",
    "treatments": [
      "Pijat Ceria (3 anak)"
    ],
    "address_info": "Jl Kemayoran III No.32, Krembangan, Surabaya",
    "pricing_details": {
      "treatment_fee": 210000,
      "delivery_fee": 25000,
      "total_price": 225000
    },
    "order_status": "DEAL",
    "notes": "Booking awalnya Kamis 30/07, di-reschedule ke Jumat 31/07",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "184",
    "customer_name": "Bunda Rosita, Manukan",
    "phone_number": "6281232760851",
    "order_index": 1,
    "order_date_chat": "2026-07-10",
    "booking_date": "Sabtu, 11/07/2026",
    "booking_time": "07.30-08.00",
    "patient_type": "Baby",
    "patient_name": "Kian Alvino Yafie (35 hari)",
    "treatments": [
      "Paket Bundling Cukur Rambut",
      "Pijat Ceria"
    ],
    "address_info": "Jl Manukan Krido X Blok 5J No.3, Tandes, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 105000
    },
    "order_status": "DEAL",
    "notes": "Form salah ketik '11 Juni', konteks jelas 11/07/2026",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "186",
    "customer_name": "Bunda Cindy, Siwalankerto",
    "phone_number": "62895364746442",
    "order_index": 1,
    "order_date_chat": "2026-08-06",
    "booking_date": "Jumat, 07/08/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Kamila Aruna (1 bulan 20 hari)",
    "treatments": [
      "Pijat Bayi Ceria + Moksa",
      "Paket Laktasi (Moms)"
    ],
    "address_info": "Jl Karah No.47D, Jambangan, Surabaya",
    "pricing_details": {
      "treatment_fee": 160000,
      "delivery_fee": 15000,
      "total_price": 170000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "187",
    "customer_name": "Bunda Khusnul, Tambak Sari Sby",
    "phone_number": "6285707077085",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Selasa, 11 Agustus 2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Kids",
    "patient_name": "Azmy Nur Rahmaniyah / Ara (2,4 tahun)",
    "treatments": [
      "Pijat Kids Ceria"
    ],
    "address_info": "Kapas Madya 5/64, Tambaksari, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 15000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; ada selisih aritmatika kecil di teks asli chat namun total final tetap 90.000",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "189",
    "customer_name": "MommBriell",
    "phone_number": "6283856165785",
    "order_index": 1,
    "order_date_chat": "2026-07-09",
    "booking_date": "Sabtu, 11/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Briell",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Gadel Timur, Surabaya Barat",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 20000,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Treatment fee tidak disebutkan eksplisit, hanya ongkir (20rb promo)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "190",
    "customer_name": "Bunda Balqis, Sidotopo Wetan",
    "phone_number": "6281259358086",
    "order_index": 1,
    "order_date_chat": "2026-07-06",
    "booking_date": "Minggu, 12/07/2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Baby",
    "patient_name": "Kaafi Adhyasta S. (10 bulan)",
    "treatments": [
      "Pijat Bapil"
    ],
    "address_info": "Platuk Gg Tauladan No 19A, Sidotopo Wetan, Kenjeran, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 20000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "191",
    "customer_name": "Bunda Sendy, Sekawan Nyaman",
    "phone_number": "6283830002010",
    "order_index": 1,
    "order_date_chat": "2026-07-22",
    "booking_date": "2026-07-26",
    "booking_time": "15.00",
    "patient_type": "Kids",
    "patient_name": "Moonel (3 tahun 8 bulan)",
    "treatments": [
      "Pijat Bapil"
    ],
    "address_info": "Jl Bumi Citra Fajar, Sekawan Nyaman IV Blok C17, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "193",
    "customer_name": "Mery",
    "phone_number": "6287855089399",
    "order_index": 1,
    "order_date_chat": "2026-07-06",
    "booking_date": "2026-07-06",
    "booking_time": "14.00",
    "patient_type": "Moms",
    "patient_name": "",
    "treatments": [
      "Paket Laktasi"
    ],
    "address_info": "Tidak disebutkan",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Same-day booking. Interaksi kedua (27/07) tidak menghasilkan deal - masih menggantung",
    "meta_matching_fields": {
      "city": null,
      "state": null,
      "zip": null,
      "country": null
    }
  },
  {
    "contact_id": "194",
    "customer_name": "Bunda Gita, Banyuurip",
    "phone_number": "62817344435",
    "order_index": 1,
    "order_date_chat": "2026-07-28",
    "booking_date": "Rabu, 29/07/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Baby",
    "patient_name": "Ezra (13 bulan)",
    "treatments": [
      "Cukur",
      "Pijat Bayi Ceria"
    ],
    "address_info": "Banyu Urip Wetan V No 45, Sawahan, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "196",
    "customer_name": "Bunda Sellynova, Kodam",
    "phone_number": "6287751148065",
    "order_index": 1,
    "order_date_chat": "2026-07-13",
    "booking_date": "Selasa, 28/07/2026",
    "booking_time": "17.00",
    "patient_type": "Kids",
    "patient_name": "Alesha (8 tahun) & Alea (2,5 tahun)",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Jl Karangan No 254A (belakang Kodam), Sawunggaling, Surabaya",
    "pricing_details": {
      "treatment_fee": 150000,
      "delivery_fee": 25000,
      "total_price": 165000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "197",
    "customer_name": "Bunda Yuanita, Rungkut",
    "phone_number": "6283832853021",
    "order_index": 1,
    "order_date_chat": "2026-08-05",
    "booking_date": "2026-08-06",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Rachel (Baby) & Rere (Kids 2-4 tahun)",
    "treatments": [
      "Pijat Ceria Bayi",
      "Pijat Ceria Kids"
    ],
    "address_info": "Rungkut Barata XV No 2, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Ongkir free (<5km); total treatment fee tidak disebutkan eksplisit",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "198",
    "customer_name": "Fatihatul Firda, Sedati",
    "phone_number": "6281252320083",
    "order_index": 1,
    "order_date_chat": "2026-07-05",
    "booking_date": "Minggu, 26/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Muhammad Abza Al Hawasyi (36 hari)",
    "treatments": [
      "Cukur",
      "Pijat Bayi Ceria"
    ],
    "address_info": "Dsn Siwalan, Ds Sedati Agung 3 RT07/RW01 No.23B, Sedati, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "199",
    "customer_name": "Bunda Heny, Jl Jatisari Pepelegi",
    "phone_number": "628123495002",
    "order_index": 1,
    "order_date_chat": "2026-07-14",
    "booking_date": "Kamis, 16/07/2026",
    "booking_time": "15.30",
    "patient_type": "Baby",
    "patient_name": "Bilawa (16 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Jl Jatisari Dalam V No 2 RT3/RW4, Pepelegi, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 5000,
      "total_price": 75000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "199",
    "customer_name": "Bunda Heny, Jl Jatisari Pepelegi",
    "phone_number": "628123495002",
    "order_index": 2,
    "order_date_chat": "2026-08-07",
    "booking_date": "2026-08-07",
    "booking_time": "12.00-12.30",
    "patient_type": "Baby",
    "patient_name": "Bilawa",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Jl Jatisari Dalam V No 2 RT3/RW4, Pepelegi, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, same-day, treatment lebih simpel (tanpa 'pulih'). Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "201",
    "customer_name": "Bunda Dita, Pabean",
    "phone_number": "6285385929440",
    "order_index": 1,
    "order_date_chat": "2026-08-05",
    "booking_date": "2026-08-08",
    "booking_time": "16.30-17.00",
    "patient_type": "Tidak diketahui",
    "patient_name": "",
    "treatments": [
      "Tidak diketahui (sama seperti sebelumnya)"
    ],
    "address_info": "Pabean, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'tetap yg kemarin2'. Detail treatment/alamat/harga tidak disebutkan di excerpt ini",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "207",
    "customer_name": "Bunda Binti, Jambangan",
    "phone_number": "6281228420441",
    "order_index": 1,
    "order_date_chat": "2026-07-20",
    "booking_date": "Sabtu, 01/08/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Kanaya Salwa E (6 bulan)",
    "treatments": [
      "Pijat Ceria Relaksasi"
    ],
    "address_info": "Jambangan Persada No 36, Jambangan, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "Sinar moksa batal, hanya relaksasi",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "209",
    "customer_name": "Bunda Mila, Taman",
    "phone_number": "6285230666631",
    "order_index": 1,
    "order_date_chat": "2026-07-24",
    "booking_date": "Rabu, 29/07/2026",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "Arkanza Elzan Hanafi (8 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Kalibader RT21 RW3 Korlap 3 No.48, Kel. Kalijaten, Kec. Taman, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 15000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "210",
    "customer_name": "Bunda Jennifer, Mulyorejo",
    "phone_number": "628113399397",
    "order_index": 1,
    "order_date_chat": "2026-07-07",
    "booking_date": "Senin, 03/08/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Raphael (1 bulan 12 hari)",
    "treatments": [
      "Cukur + Pijat Terapi (Baby)",
      "Breast + Oksitosin Full Body (Moms)"
    ],
    "address_info": "Wisma Permai Barat III NN52, Mulyorejo, Surabaya",
    "pricing_details": {
      "treatment_fee": 240000,
      "delivery_fee": 25000,
      "total_price": 255000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "211",
    "customer_name": "Bunda Tiara, Tenggilis",
    "phone_number": "62895631325027",
    "order_index": 1,
    "order_date_chat": "2026-07-31",
    "booking_date": "2026-08-01",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "Yokhebed Prisillia Janet (14 bulan)",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Panjang Jiwo Gg Tembusan No 3, Tenggilis Mejoyo, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "212",
    "customer_name": "Bunda Nilam, Tanggulangin",
    "phone_number": "6289696351095",
    "order_index": 1,
    "order_date_chat": "2026-07-30",
    "booking_date": "Sabtu, 01/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Astama (41 hari)",
    "treatments": [
      "Cukur",
      "Pijat Terapi (Paket Selapan)"
    ],
    "address_info": "Perumtas 2 Blok N3 No.21, Tanggulangin, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 25000,
      "total_price": 110000
    },
    "order_status": "DEAL",
    "notes": "Rescheduled dari jam 11.00",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "218",
    "customer_name": "Bunda Nola, Kandangan",
    "phone_number": "6285608582871",
    "order_index": 1,
    "order_date_chat": "2026-07-17",
    "booking_date": "Sabtu, 25/07/2026",
    "booking_time": "10.00-10.30",
    "patient_type": "Baby",
    "patient_name": "Dio Rayyan Athallah (8 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Jl Tengger Rejo Mulyo III No.41, Kandangan, Benowo, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 30000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "219",
    "customer_name": "Bunda Nita, Dukuh Pakis",
    "phone_number": "6282141377288",
    "order_index": 1,
    "order_date_chat": "2026-07-12",
    "booking_date": "2026-07-12",
    "booking_time": "12.30-13.00",
    "patient_type": "Baby",
    "patient_name": "Muhammad Shaka Navendra (9 bulan)",
    "treatments": [
      "Pijat Terapi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Jl Dukuh Pakis Gg 1 No 71 (blkg SDN 1 Dukuh Pakis), Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Same-day booking",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "220",
    "customer_name": "Bunda Galuh, Sukomanunggal",
    "phone_number": "6281804191001",
    "order_index": 1,
    "order_date_chat": "2026-07-27",
    "booking_date": "2026-07-28",
    "booking_time": "14.00-14.30",
    "patient_type": "Kids",
    "patient_name": "Devin (2 tahun 8 bulan)",
    "treatments": [
      "Pijat Pulih Ceria",
      "Moksa"
    ],
    "address_info": "Jl Putat Indah Tengah No 20-22, Sukomanunggal, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "221",
    "customer_name": "Bunda Sheiva, Lidah Kulon",
    "phone_number": "6285792709135",
    "order_index": 1,
    "order_date_chat": "2026-07-25",
    "booking_date": "Minggu, 26/07/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Athaya Barcah R (11 bulan)",
    "treatments": [
      "Pijat Bayi Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Sepat Lidah Kulon RT06/RW03 (depan warung madura pagar hijau), Lakarsantri, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Kedatangan dimajukan ke jam 11.00-11.30 di hari-H",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "222",
    "customer_name": "syarifa, Gedangan",
    "phone_number": "628993868131",
    "order_index": 1,
    "order_date_chat": "2026-07-27",
    "booking_date": "Rabu, 29/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Humaira Putri Arsyi (11 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Tebel Barat RT1/RW1 (depan makam Islam, samping warung madura), Gedangan, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 35000,
      "delivery_fee": 10000,
      "total_price": 45000
    },
    "order_status": "DEAL",
    "notes": "Harga awal 80.000, pelanggan mendapat diskon ulang tahun 50% sehingga total akhir dibayar 45.000",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "223",
    "customer_name": "Bunda Friesma, Waru",
    "phone_number": "6281233746354",
    "order_index": 1,
    "order_date_chat": "2026-07-26",
    "booking_date": "2026-07-26",
    "booking_time": "~13.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Paket Bayi Relaksasi"
    ],
    "address_info": "Jl Arjuna 38, Perum Pepelegi Indah, Waru",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti kemarin', same-day. Nama bayi/harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "225",
    "customer_name": "Bunda Fellicia, Pondhok Tjandra",
    "phone_number": "6287852674363",
    "order_index": 1,
    "order_date_chat": "2026-07-25",
    "booking_date": "Senin, 27/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Maverich (1 bulan 25 hari)",
    "treatments": [
      "Pijat Bayi Ceria (Baby)",
      "Oksitosin Full Body (Moms)"
    ],
    "address_info": "Jeruk VII No 439, Pondok Candra",
    "pricing_details": {
      "treatment_fee": 165000,
      "delivery_fee": 0,
      "total_price": 165000
    },
    "order_status": "DEAL",
    "notes": "Ongkir free",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "226",
    "customer_name": "Bunda Devia, Babatan",
    "phone_number": "6285850166929",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Mulai 12 Agustus 2026",
    "booking_time": "07.00-07.30 (pagi & sore)",
    "patient_type": "Baby",
    "patient_name": "Alessia (0 bulan, newborn)",
    "treatments": [
      "Paket Newborn Komplit Pagi-Sore (1 minggu, 14x kunjungan)"
    ],
    "address_info": "Babatan Pilang V No 22, Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 500000,
      "delivery_fee": 280000,
      "total_price": 780000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup. Paket diperpanjang 1 minggu lagi oleh pelanggan dengan penyesuaian jadwal - kemungkinan ada order/pembayaran tambahan yang tidak fully direkap di chat ini",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "227",
    "customer_name": "Bunda Farida, Bungurasih",
    "phone_number": "6285645535557",
    "order_index": 1,
    "order_date_chat": "2026-08-01",
    "booking_date": "Sabtu, 08/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Moms",
    "patient_name": "Farida (hamil 27 minggu)",
    "treatments": [
      "Pijat Hamil (90 menit, upgrade dari 60 menit)"
    ],
    "address_info": "Bungurasih Utara V No 16 RT01/RW04, Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 150000,
      "delivery_fee": 0,
      "total_price": 150000
    },
    "order_status": "DEAL",
    "notes": "Ongkir free (<5km)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "232",
    "customer_name": "Bunda Meta, Rungkut Jauh",
    "phone_number": "6287855873973",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Kamis, 23 Juli 2026",
    "booking_time": "Tidak diketahui",
    "patient_type": "Baby",
    "patient_name": "Zayyan (1,5 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Griya Amerta Blok I 10, Rungkut, Surabaya",
    "pricing_details": {
      "treatment_fee": 70000,
      "delivery_fee": 25000,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "232",
    "customer_name": "Bunda Meta, Rungkut Jauh",
    "phone_number": "6287855873973",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Besok (timestamp korup)",
    "booking_time": "07.00-07.30",
    "patient_type": "Baby",
    "patient_name": "Zayyan",
    "treatments": [
      "Pijat Bayi Pulih Ceria"
    ],
    "address_info": "Griya Amerta Blok I 10, Rungkut, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama bunda, adik masih sering kembung'. Harga tidak direkap ulang (kemungkinan sama ~85.000)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "232",
    "customer_name": "Bunda Meta, Rungkut Jauh",
    "phone_number": "6287855873973",
    "order_index": 3,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tanggal 17 (bulan tidak pasti, timestamp korup)",
    "booking_time": "09.30-10.00",
    "patient_type": "Combination",
    "patient_name": "Zayyan (Baby) & Bunda Meta (Moms)",
    "treatments": [
      "Pijat Bayi Pulih Ceria (Zayyan, carried)",
      "Pijat Pasca Melahirkan (Bunda Meta, 60 menit)"
    ],
    "address_info": "Griya Amerta Blok I 10, Rungkut, Surabaya",
    "pricing_details": {
      "treatment_fee": 105000,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order kombinasi. Treatment fee 105.000 disebutkan untuk bagian Moms; total gabungan tidak direkap penuh di chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "240",
    "customer_name": "fia, Wonocolo",
    "phone_number": "6285785096124",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "Senin, 06/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Elvano (3 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Jemurwonosari Gg Kyai Mualim No 6D, Wonocolo, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 15000,
      "total_price": 90000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "242",
    "customer_name": "Bunda Mika, Tegalsari",
    "phone_number": "6281217332334",
    "order_index": 1,
    "order_date_chat": "2026-07-06",
    "booking_date": "2026-07-07",
    "booking_time": "11.30-12.00",
    "patient_type": "Combination",
    "patient_name": "Naomi (Baby)",
    "treatments": [
      "Pijat Bayi (carried, sama seperti kemarin)",
      "Pijat Hamil (Moms, 60 menit)"
    ],
    "address_info": "Tegalsari, Surabaya",
    "pricing_details": {
      "treatment_fee": 170000,
      "delivery_fee": 15000,
      "total_price": 185000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas untuk baby + tambahan pijat hamil untuk bunda",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "243",
    "customer_name": "Viska, Rungkut",
    "phone_number": "6281358745420",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "2026-07-04",
    "booking_time": "10.00-10.30",
    "patient_type": "Baby",
    "patient_name": "Azalea (1 bulan 6 hari)",
    "treatments": [
      "Cukur",
      "Pijat Bayi Terapi"
    ],
    "address_info": "Jl Medayu Utara XXX D2 No 5B, Rungkut, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 0,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Ongkir free",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "246",
    "customer_name": "Bunda Azalia W, Bratang",
    "phone_number": "6285230002359",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Senin, 17 Agustus 2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Leon (7 bulan)",
    "treatments": [
      "Pijat Bayi Ceria Relaksasi"
    ],
    "address_info": "Bratang Binangun IV/12, Gubeng, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat customer follow-up. Harga tidak direkap ulang ('sama seperti sebelumnya'). Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "251",
    "customer_name": "Bunda Dwi Monica, Apt Kertajaya",
    "phone_number": "6282113131445",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Minggu, 16 Agustus 2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Combination",
    "patient_name": "Raeluna (3 bulan)",
    "treatments": [
      "Pijat Bayi Ceria (Baby)",
      "Breast + Oksitosin Massage Fullbody (Moms)"
    ],
    "address_info": "Apartemen Puncak Kertajaya, Keputih, Surabaya",
    "pricing_details": {
      "treatment_fee": 215000,
      "delivery_fee": 25000,
      "total_price": 230000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "255",
    "customer_name": "Windy Ariesta, Waru",
    "phone_number": "6283854203005",
    "order_index": 1,
    "order_date_chat": "2026-07-24",
    "booking_date": "2026-07-24",
    "booking_time": "Same day",
    "patient_type": "Baby",
    "patient_name": "Revan",
    "treatments": [
      "Pijat Ceria/Pulih Ceria (tergantung batuk)"
    ],
    "address_info": "Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga dasar tidak disebutkan jelas",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "255",
    "customer_name": "Windy Ariesta, Waru",
    "phone_number": "6283854203005",
    "order_index": 2,
    "order_date_chat": "2026-08-02",
    "booking_date": "Selasa, 04/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Revan",
    "treatments": [
      "Pijat Bapil"
    ],
    "address_info": "Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 63000,
      "delivery_fee": 10000,
      "total_price": 73000
    },
    "order_status": "DEAL",
    "notes": "Harga 63.000 setelah diskon 10%",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "258",
    "customer_name": "Bunda Ayu, Bulusidokare",
    "phone_number": "6281555475917",
    "order_index": 1,
    "order_date_chat": "2026-07-07",
    "booking_date": "2026-07-08",
    "booking_time": "09.00-09.30",
    "patient_type": "Moms",
    "patient_name": "",
    "treatments": [
      "Oksitosin Full Body Massage"
    ],
    "address_info": "Bulusidokare, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 105000,
      "delivery_fee": 20000,
      "total_price": 125000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "258",
    "customer_name": "Bunda Ayu, Bulusidokare",
    "phone_number": "6281555475917",
    "order_index": 2,
    "order_date_chat": "2026-07-17",
    "booking_date": "Minggu, 19/07/2026",
    "booking_time": "09.30-10.00",
    "patient_type": "Combination",
    "patient_name": "",
    "treatments": [
      "Oksitosin (non-fullbody)"
    ],
    "address_info": "Bulusidokare, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Detail treatment agak ambigu di chat; harga tidak direkap",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "258",
    "customer_name": "Bunda Ayu, Bulusidokare",
    "phone_number": "6281555475917",
    "order_index": 3,
    "order_date_chat": "2026-08-02",
    "booking_date": "Selasa, 04/08/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Combination",
    "patient_name": "Elzira (1 bulan 13 hari)",
    "treatments": [
      "Pijat Ceria (Baby)",
      "Full Body (Moms, tambahan)"
    ],
    "address_info": "Perum Citra Padova Gang F No 3136, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 175000,
      "delivery_fee": 20000,
      "total_price": 195000
    },
    "order_status": "DEAL",
    "notes": "Banyak reschedule sebelum akhirnya deal",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "260",
    "customer_name": "Bunda Christine, Citraland Wiyung",
    "phone_number": "628113446100",
    "order_index": 1,
    "order_date_chat": "2026-08-08",
    "booking_date": "Minggu, 09/08/2026",
    "booking_time": "07.30-08.00",
    "patient_type": "Kids",
    "patient_name": "Saila & Nuala",
    "treatments": [
      "Pijat Bapil (Saila)",
      "Pijat Capek/Pegal (Nuala)"
    ],
    "address_info": "District 9, Citraland, Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 155000,
      "delivery_fee": 25000,
      "total_price": 180000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "263",
    "customer_name": "Bunda Dewi, Waru",
    "phone_number": "6281332993933",
    "order_index": 1,
    "order_date_chat": "2026-08-04",
    "booking_date": "2026-08-04",
    "booking_time": "Malam",
    "patient_type": "Moms",
    "patient_name": "",
    "treatments": [
      "Paket Laktasi"
    ],
    "address_info": "Kontrakan dekat rumah ibu, Waru",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Same-day booking; harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "264",
    "customer_name": "Bunda Ella, Damarsih",
    "phone_number": "6282234593428",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Sabtu, 08 Agustus 2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Baby",
    "patient_name": "Yoga (1 bulan)",
    "treatments": [
      "Pijat Ceria",
      "Moksa"
    ],
    "address_info": "Safira Juanda Resort Cluster Valley Blok E6/25, Buduran, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "269",
    "customer_name": "Bunda Megga, Siwalankerto",
    "phone_number": "6281280800021",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Selasa, 14 Juli 2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Khayliza QA (15 hari)",
    "treatments": [
      "Pijat Bayi Ceria",
      "Tindik"
    ],
    "address_info": "Siwalankerto Timur VD No.30, Wonocolo, Surabaya",
    "pricing_details": {
      "treatment_fee": 110000,
      "delivery_fee": 0,
      "total_price": 110000
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; ongkir free",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "269",
    "customer_name": "Bunda Megga, Siwalankerto",
    "phone_number": "6281280800021",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Selasa (tanggal lain, timestamp korup)",
    "booking_time": "11.00-11.30",
    "patient_type": "Baby",
    "patient_name": "Khayliza QA",
    "treatments": [
      "Paket Selapan"
    ],
    "address_info": "Siwalankerto Timur VD No.30, Wonocolo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, upgrade treatment. Harga tidak direkap",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "269",
    "customer_name": "Bunda Megga, Siwalankerto",
    "phone_number": "6281280800021",
    "order_index": 3,
    "order_date_chat": "2026-08-17",
    "booking_date": "Besok (timestamp korup)",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Khayliza QA",
    "treatments": [
      "Tidak diketahui (terpotong di chat)"
    ],
    "address_info": "Siwalankerto Timur VD No.30, Wonocolo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Slot sudah dikonfirmasi 'keep' namun jenis treatment belum sempat terekam di excerpt chat (terpotong)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "272",
    "customer_name": "Diana, Sedati",
    "phone_number": "6282230555515",
    "order_index": 1,
    "order_date_chat": "2026-07-06",
    "booking_date": "Rabu, 08/07/2026",
    "booking_time": "14.30-15.00",
    "patient_type": "Baby",
    "patient_name": "Gavin (8 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Perintis 3 RT 8, Sedati, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "273",
    "customer_name": "Diana, Kenjeran",
    "phone_number": "6282230422079",
    "order_index": 1,
    "order_date_chat": "2026-08-03",
    "booking_date": "Rabu, 05/08/2026",
    "booking_time": "11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "Davi",
    "treatments": [
      "Pijat Pulih Ceria"
    ],
    "address_info": "Kenjeran, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti kemarin' (karena bapil + tumbuh gigi). Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "275",
    "customer_name": "Bunda Bella, Candi Jauh",
    "phone_number": "6289670370062",
    "order_index": 1,
    "order_date_chat": "2026-07-17",
    "booking_date": "Minggu, 19/07/2026",
    "booking_time": "11.00-11.30",
    "patient_type": "Moms",
    "patient_name": "Bella (hamil 37-38 minggu)",
    "treatments": [
      "Induksi Massage Fullbody"
    ],
    "address_info": "Desa Kedungkendo RT07/RW02, Candi, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 105000,
      "delivery_fee": 20000,
      "total_price": 125000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "277",
    "customer_name": "Bunda riskaamana, Waru",
    "phone_number": "6285238460006",
    "order_index": 1,
    "order_date_chat": "2026-07-13",
    "booking_date": "2026-07-14",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "Fathan",
    "treatments": [
      "Tidak diketahui (carried, sama bubid)"
    ],
    "address_info": "Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas. Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "277",
    "customer_name": "Bunda riskaamana, Waru",
    "phone_number": "6285238460006",
    "order_index": 2,
    "order_date_chat": "2026-08-06",
    "booking_date": "2026-08-06",
    "booking_time": "~11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "Fathan",
    "treatments": [
      "Pijat Bapil",
      "Sinar Moksa"
    ],
    "address_info": "Waru, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, same-day, upgrade treatment karena pilek. Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "279",
    "customer_name": "Bunda Yanti Klampis, Sukolilo",
    "phone_number": "6281803059159",
    "order_index": 1,
    "order_date_chat": "2026-08-08",
    "booking_date": "Senin (besok)",
    "booking_time": "16.30-17.00",
    "patient_type": "Baby",
    "patient_name": "Lorenzo",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Klampis, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat customer follow-up. Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "280",
    "customer_name": "Bunda indra, Sambikerep",
    "phone_number": "6285692444298",
    "order_index": 1,
    "order_date_chat": "2026-07-30",
    "booking_date": "Rabu, 05/08/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Chiara (10 bulan) & Cio (3,5 tahun)",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Jl Raya Bungkal No.17 RT06, Sambikerep, Surabaya",
    "pricing_details": {
      "treatment_fee": 130000,
      "delivery_fee": 25000,
      "total_price": 155000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "282",
    "customer_name": "Bunda Alip, Buduran Bandarmukti Residence",
    "phone_number": "6285230386917",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Kamis (setelah reschedule dari Minggu 16 Agustus, timestamp korup)",
    "booking_time": "14.30-15.00",
    "patient_type": "Baby",
    "patient_name": "Naira (12 hari)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa",
      "Mandiin (tambahan)"
    ],
    "address_info": "Banjarmukti Residence Blok G-6A, Buduran, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Timestamp korup; komponen harga tidak fully direkap (base treatment + ongkir + 30rb mandiin)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "283",
    "customer_name": "Bunda Putri, Keputih Sukolilo",
    "phone_number": "6281226980227",
    "order_index": 1,
    "order_date_chat": "2026-07-04",
    "booking_date": "Senin (besok)",
    "booking_time": "12.30-13.00",
    "patient_type": "Baby",
    "patient_name": "Ryu",
    "treatments": [
      "Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Keputih, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "284",
    "customer_name": "Sita, Wonokromo",
    "phone_number": "6285755140841",
    "order_index": 1,
    "order_date_chat": "2026-07-05",
    "booking_date": "Selasa, 07/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Combination",
    "patient_name": "Sabira (42 hari)",
    "treatments": [
      "Pijat Bayi Pulih Ceria (Baby)",
      "Paket Laktasi (Moms)"
    ],
    "address_info": "Jl Gembili Raya No.33, Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 150000,
      "delivery_fee": 25000,
      "total_price": 165000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "285",
    "customer_name": "Rachell Fattama Az Zahrah",
    "phone_number": "6281359461496",
    "order_index": 1,
    "order_date_chat": "2026-07-16",
    "booking_date": "Jumat, 17/07/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Combination",
    "patient_name": "Nicholas (7 bulan)",
    "treatments": [
      "Pulih Ceria (Baby)",
      "Oksitosin Full Body + Breast Massage (Moms)"
    ],
    "address_info": "Wonokusumo 38, Semampir, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 25000,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Total treatment fee tidak direkap penuh di chat, hanya ongkir yang jelas (25rb)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "286",
    "customer_name": "Bunda Tita, Gunungsari",
    "phone_number": "6281703396371",
    "order_index": 1,
    "order_date_chat": "2026-07-14",
    "booking_date": "Sabtu, 18/07/2026",
    "booking_time": "10.30",
    "patient_type": "Baby",
    "patient_name": "Kanaya (2 bulan 10 hari)",
    "treatments": [
      "Pijat Bayi (40 menit)"
    ],
    "address_info": "Alana Regency Gunungsari Indah Blok D30, Kedurus, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Total tidak direkap sebagai satu nilai tunggal di chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "287",
    "customer_name": "Bunda Dewi, Masjid Agung",
    "phone_number": "6281515739227",
    "order_index": 1,
    "order_date_chat": "2026-07-17",
    "booking_date": "2026-07-18",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Zehaan Daniswara R (4 bulan 3 minggu)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Jl Sepanjang Indah Blk Babakan XIV No.3, Taman, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "289",
    "customer_name": "Bunda Nabila, Gedangan Juanda",
    "phone_number": "6289606182151",
    "order_index": 1,
    "order_date_chat": "2026-07-03",
    "booking_date": "Senin, 20/07/2026",
    "booking_time": "13.00",
    "patient_type": "Baby",
    "patient_name": "Fatimah Nala Savrinadeya (17 bulan)",
    "treatments": [
      "Pijat + Sinar Moksa"
    ],
    "address_info": "Jl Mandala IV No.472 RT18/RW5, Gedangan, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak direkap di chat",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "290",
    "customer_name": "Nisamahardilla, Wonokromo",
    "phone_number": "6281330453185",
    "order_index": 1,
    "order_date_chat": "2026-08-01",
    "booking_date": "Senin, 03/08/2026",
    "booking_time": "11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Pijat Pulih Ceria"
    ],
    "address_info": "Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti sebelumnya'",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "292",
    "customer_name": "Bunda Novia, Babatan",
    "phone_number": "6282114458319",
    "order_index": 1,
    "order_date_chat": "2026-08-01",
    "booking_date": "Senin, 03/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Gita (14 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Jl Griya Babatan Mukti IV Blok N38, Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "293",
    "customer_name": "ernik, Wonokromo",
    "phone_number": "6288989548760",
    "order_index": 1,
    "order_date_chat": "2026-07-03",
    "booking_date": "Senin, 06/07/2026",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "Ellena",
    "treatments": [
      "Tidak diketahui detail"
    ],
    "address_info": "Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "293",
    "customer_name": "ernik, Wonokromo",
    "phone_number": "6288989548760",
    "order_index": 2,
    "order_date_chat": "2026-08-04",
    "booking_date": "Rabu, 05/08/2026",
    "booking_time": "13.30-14.00",
    "patient_type": "Baby",
    "patient_name": "Ellena",
    "treatments": [
      "Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Wonokromo, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 15000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "Upgrade treatment dari order sebelumnya",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "295",
    "customer_name": "Yunita, Buduran",
    "phone_number": "6285746368353",
    "order_index": 1,
    "order_date_chat": "2026-08-09",
    "booking_date": "2026-08-10",
    "booking_time": "16.00",
    "patient_type": "Baby",
    "patient_name": "Azqiara",
    "treatments": [
      "Tidak diketahui (carried, sama bu bid)"
    ],
    "address_info": "Buduran, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas. Alamat/harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "296",
    "customer_name": "Bunda Ananda, Sukodono",
    "phone_number": "6285755550968",
    "order_index": 1,
    "order_date_chat": "2026-08-07",
    "booking_date": "Minggu, 09/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Kids",
    "patient_name": "Akhtar (14 bulan)",
    "treatments": [
      "Pijat Relaksasi"
    ],
    "address_info": "Pondok Berlian Gang Sawah Panjunan, Sukodono, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 25000,
      "total_price": 75000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "297",
    "customer_name": "Bunda Inggrid, Tenggilis",
    "phone_number": "6281339001971",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Mulai Kamis, 13 Agustus 2026 (paket 10x sesi)",
    "booking_time": "Bervariasi per sesi",
    "patient_type": "Moms",
    "patient_name": "",
    "treatments": [
      "Oksitosin Massage (punggung, 30 menit/sesi) - Paket 10x kunjungan"
    ],
    "address_info": "Tenggilis Barat V F16, Tenggilis Mejoyo, Surabaya",
    "pricing_details": {
      "treatment_fee": 850000,
      "delivery_fee": 0,
      "total_price": 850000
    },
    "order_status": "DEAL",
    "notes": "Paket dinegosiasikan dari 1.150.000 menjadi 850.000 (sudah termasuk ongkir). Timestamp korup. Beberapa sesi lanjutan sempat di-skip oleh pelanggan - jumlah sesi yang benar-benar terlaksana tidak dapat dipastikan dari chat",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "298",
    "customer_name": "Bunda Oktavia, Sawotratap",
    "phone_number": "6285655010908",
    "order_index": 1,
    "order_date_chat": "2026-08-09",
    "booking_date": "Senin, 10 Agustus 2026",
    "booking_time": "14.00-14.30",
    "patient_type": "Kids",
    "patient_name": "Zayn (27 bulan)",
    "treatments": [
      "Pijat + Moksa (Bapil)"
    ],
    "address_info": "Jl Anusapati 109, Sawotratap, Gedangan, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 0,
      "total_price": 85000
    },
    "order_status": "DEAL",
    "notes": "Ongkir free (<4,5km); jam diundur ke 14.30 di hari-H",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "302",
    "customer_name": "Bunda Prischilla",
    "phone_number": "6281234285950",
    "order_index": 1,
    "order_date_chat": "2026-07-05",
    "booking_date": "Kamis, 09/07/2026",
    "booking_time": "15.00-15.30",
    "patient_type": "Baby",
    "patient_name": "Raphael (13 bulan)",
    "treatments": [
      "Paket Pulih Ceria",
      "Sinar Moksa"
    ],
    "address_info": "Sambisari 1 Gang Jeruk No.3, Sambikerep, Surabaya",
    "pricing_details": {
      "treatment_fee": 85000,
      "delivery_fee": 15000,
      "total_price": 100000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "303",
    "customer_name": "sendy, Simokerto",
    "phone_number": "6285853267605",
    "order_index": 1,
    "order_date_chat": "2026-07-18",
    "booking_date": "Senin, 20/07/2026",
    "booking_time": "09.30-10.00",
    "patient_type": "Combination",
    "patient_name": "El Zafran Mikail Uwais (1 bulan)",
    "treatments": [
      "Pijat Bayi Pulih Ceria (Baby)",
      "Oksitosin Massage Fullbody (Moms)"
    ],
    "address_info": "Jl Granting Gg2 No.33, Simokerto, Surabaya",
    "pricing_details": {
      "treatment_fee": 175000,
      "delivery_fee": 20000,
      "total_price": 195000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "305",
    "customer_name": "Bunda Hera, Juanda Residence",
    "phone_number": "628113141111",
    "order_index": 1,
    "order_date_chat": "2026-07-26",
    "booking_date": "Kamis, 30/07/2026",
    "booking_time": "15.30-16.00",
    "patient_type": "Baby",
    "patient_name": "Elhan",
    "treatments": [
      "Pijat Baby"
    ],
    "address_info": "Perum Green Garden Residence Juanda I No B12, Semampir Sedati, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti sebelumnya', same-day. Harga sesi ini tidak direkap ulang (sesi sebelumnya di bulan Mei senilai 60.000)",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "307",
    "customer_name": "Bunda Fitriana, Waru",
    "phone_number": "6289633016190",
    "order_index": 1,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak diketahui (timestamp korup)",
    "booking_time": "10.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Pijat Bayi Ceria (Relaksasi)"
    ],
    "address_info": "Berbek, Waru",
    "pricing_details": {
      "treatment_fee": 54000,
      "delivery_fee": 0,
      "total_price": 54000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas 'sama seperti kemarin'. Harga 54.000 setelah diskon 10% promo IG. Timestamp korup",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "307",
    "customer_name": "Bunda Fitriana, Waru",
    "phone_number": "6289633016190",
    "order_index": 2,
    "order_date_chat": "2026-08-17",
    "booking_date": "Tidak diketahui (timestamp korup)",
    "booking_time": "10.30-11.00",
    "patient_type": "Baby",
    "patient_name": "",
    "treatments": [
      "Tidak diketahui (dipertimbangkan tambahan sinar moksa, terpotong di chat)"
    ],
    "address_info": "Berbek, Waru",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Slot sudah dikonfirmasi 'keep', jenis treatment akhir belum sempat terekam di excerpt",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "308",
    "customer_name": "Gobii, Dukuh Pakis",
    "phone_number": "6281241245461",
    "order_index": 1,
    "order_date_chat": "2026-08-01",
    "booking_date": "Selasa, 4 Agustus 2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Samudra (9 bulan)",
    "treatments": [
      "Paket Selapan (awalnya Ceria, diubah ke Terapi di hari-H karena batuk)"
    ],
    "address_info": "Jl Dukuh Kupang Barat X/6A, Dukuh Pakis, Surabaya",
    "pricing_details": {
      "treatment_fee": 80000,
      "delivery_fee": 25000,
      "total_price": 95000
    },
    "order_status": "DEAL",
    "notes": "Harga berdasarkan Paket Selapan Ceria awal; versi Terapi (diubah di hari-H) tidak direkap ulang harganya",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "309",
    "customer_name": "Bunda Deny, Wiyung",
    "phone_number": "6285730250002",
    "order_index": 1,
    "order_date_chat": "2026-08-04",
    "booking_date": "Minggu, 09 Agustus 2026",
    "booking_time": "10.00",
    "patient_type": "Kids",
    "patient_name": "Ryu Kamil (14 bulan) & Syauqi Malik (13 bulan)",
    "treatments": [
      "Pijat Bayi Lahap Makan (Ryu)",
      "Pijat Ceria (Syauqi)"
    ],
    "address_info": "Jl Balas Klumprik No.26 Gang Makam (dekat Pabrik Tandon MPOIN), Wiyung, Surabaya",
    "pricing_details": {
      "treatment_fee": 135000,
      "delivery_fee": 15000,
      "total_price": 150000
    },
    "order_status": "DEAL",
    "notes": "2 anak sepupuan, dipijat bersamaan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "310",
    "customer_name": "Bunda Zelikadewi, Semolowaru",
    "phone_number": "62881026768099",
    "order_index": 1,
    "order_date_chat": "2026-07-10",
    "booking_date": "Senin, 13/07/2026",
    "booking_time": "09.00-09.30",
    "patient_type": "Baby",
    "patient_name": "Zayn (15 bulan)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "Jl Semolowaru Utara III No.44A, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 25000,
      "total_price": 75000
    },
    "order_status": "DEAL",
    "notes": "",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "310",
    "customer_name": "Bunda Zelikadewi, Semolowaru",
    "phone_number": "62881026768099",
    "order_index": 2,
    "order_date_chat": "2026-07-27",
    "booking_date": "2026-07-27",
    "booking_time": "11.30-12.00",
    "patient_type": "Baby",
    "patient_name": "Zayn",
    "treatments": [
      "Pijat Bayi Pulih Ceria/Bapil (tanpa moksa)"
    ],
    "address_info": "Jl Semolowaru Utara III No.44A, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, same-day. Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "310",
    "customer_name": "Bunda Zelikadewi, Semolowaru",
    "phone_number": "62881026768099",
    "order_index": 3,
    "order_date_chat": "2026-08-10",
    "booking_date": "2026-08-10",
    "booking_time": "10.00-11.00",
    "patient_type": "Combination",
    "patient_name": "Zayn + 1 anak tetangga (seusia)",
    "treatments": [
      "Pijat Bayi (carried, untuk 2 anak)"
    ],
    "address_info": "Jl Semolowaru Utara III No.44A, Sukolilo, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, same-day, dengan tambahan 1 anak tetangga. Harga tidak disebutkan (ongkos digabung)",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "311",
    "customer_name": "Bunda Nara, Little Ummaya Daycare Waru",
    "phone_number": "6281282572211",
    "order_index": 1,
    "order_date_chat": "2026-08-04",
    "booking_date": "2026-08-05",
    "booking_time": "15.00-15.30",
    "patient_type": "Combination",
    "patient_name": "Salwa & Ibham (4-6 tahun)",
    "treatments": [
      "Pijat Bayi + Moksa (Salwa)",
      "Kids Massage (Ibham)"
    ],
    "address_info": "Griyo Mapan Sentosa (lokasi daycare)",
    "pricing_details": {
      "treatment_fee": 160000,
      "delivery_fee": 0,
      "total_price": 160000
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, harga sama seperti sebelumnya",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "312",
    "customer_name": "Bunda Ifa, Tambak Oso",
    "phone_number": "6289675128793",
    "order_index": 1,
    "order_date_chat": "2026-08-08",
    "booking_date": "Sabtu, 08/08/2026",
    "booking_time": "18.30-19.00",
    "patient_type": "Baby",
    "patient_name": "Hasbi (2 bulan kurang 1 minggu)",
    "treatments": [
      "Pijat Bayi Ceria"
    ],
    "address_info": "The Oso, The Wise Blok C-06, Tambak Oso, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 60000,
      "delivery_fee": 15000,
      "total_price": 70000
    },
    "order_status": "DEAL",
    "notes": "Same-day booking",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "313",
    "customer_name": "Bunda Feilina, Dian Apt Keputih",
    "phone_number": "628994381111",
    "order_index": 1,
    "order_date_chat": "2026-08-05",
    "booking_date": "Kamis, 06/08/2026",
    "booking_time": "13.00-13.30",
    "patient_type": "Baby",
    "patient_name": "Graceva (6 bulan)",
    "treatments": [
      "Pijat Ceria"
    ],
    "address_info": "Dian Regency Apartemen, Surabaya",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Same-day booking; harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Surabaya",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "314",
    "customer_name": "Bunda Hida, Taman",
    "phone_number": "6287815918787",
    "order_index": 1,
    "order_date_chat": "2026-07-21",
    "booking_date": "Rabu, 22/07/2026",
    "booking_time": "12.00-12.30",
    "patient_type": "Baby",
    "patient_name": "Nadhira",
    "treatments": [
      "Pijat + Sinar Moksa"
    ],
    "address_info": "Taman, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  },
  {
    "contact_id": "314",
    "customer_name": "Bunda Hida, Taman",
    "phone_number": "6287815918787",
    "order_index": 2,
    "order_date_chat": "2026-08-05",
    "booking_date": "Selasa, 11/08/2026",
    "booking_time": "16.30-17.00",
    "patient_type": "Baby",
    "patient_name": "Nadhira",
    "treatments": [
      "Tidak diketahui (carried, sama seperti biasanya)"
    ],
    "address_info": "Taman, Sidoarjo",
    "pricing_details": {
      "treatment_fee": 0,
      "delivery_fee": 0,
      "total_price": 0
    },
    "order_status": "DEAL",
    "notes": "Repeat order chat bebas, banyak reschedule sebelum akhirnya deal. Harga tidak disebutkan",
    "meta_matching_fields": {
      "city": "Sidoarjo",
      "state": "Jawa Timur",
      "zip": null,
      "country": "ID"
    }
  }
];

export async function syncAndEnrichExportData(prisma: PrismaClient, tenantId = 'default-tenant') {
  console.log(`=== Starting Sync and Enrichment for ${RAW_EXPORT_DATA.length} export records ===`);
  
  let customersCreated = 0;
  let customersUpdated = 0;
  let childrenUpserted = 0;
  let reservationsCreated = 0;
  let reservationsUpdated = 0;

  for (const item of RAW_EXPORT_DATA) {
    const phone = normalizePhone(item.phone_number);
    const cleanName = cleanCustomerName(item.customer_name);
    const bookingDate = parseBookingDateTime(item.booking_date, item.order_date_chat);
    const category = mapPatientTypeToCategory(item.patient_type, item.treatments);
    
    // 1. Find or create Customer
    let customer = await prisma.customer.findUnique({
      where: { phone },
      include: { children: true, reservations: true }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          phone,
          name: cleanName,
          kota: item.meta_matching_fields.city || (item.address_info.includes('Surabaya') ? 'Surabaya' : item.address_info.includes('Sidoarjo') ? 'Sidoarjo' : 'Surabaya'),
          is_legacy_source: true,
          status: 'active',
        },
        include: { children: true, reservations: true }
      });
      customersCreated++;
    } else {
      // Enrich customer details if missing or placeholder
      const updates: any = {};
      if ((!customer.name || customer.name.toLowerCase() === 'bunda') && cleanName) {
        updates.name = cleanName;
      }
      if (!customer.kota && item.meta_matching_fields.city) {
        updates.kota = item.meta_matching_fields.city;
      }
      if (Object.keys(updates).length > 0) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: updates,
          include: { children: true, reservations: true }
        });
        customersUpdated++;
      }
    }

    // 2. Upsert Children
    const parsedPatients = parsePatientAgeAndName(item.patient_name);
    for (const p of parsedPatients) {
      if (!p.name) continue;
      const existingChild = customer.children?.find(c => c.name.toLowerCase() === p.name.toLowerCase());
      if (!existingChild) {
        await prisma.child.create({
          data: {
            tenant_id: tenantId,
            customer_id: customer.id,
            name: p.name,
            raw_age_text: p.ageText || null,
            age_months_at_registration: p.ageMonths || null,
          }
        });
        childrenUpserted++;
      } else if (!existingChild.raw_age_text && p.ageText) {
        await prisma.child.update({
          where: { id: existingChild.id },
          data: {
            raw_age_text: p.ageText,
            age_months_at_registration: p.ageMonths || existingChild.age_months_at_registration
          }
        });
        childrenUpserted++;
      }
    }

    // 3. Match / Upsert Reservation
    const purchaseVal = item.pricing_details.total_price > 0 
      ? item.pricing_details.total_price 
      : (item.pricing_details.treatment_fee > 0 ? item.pricing_details.treatment_fee : null);

    const treatmentList = item.treatments.filter(t => t && !t.toLowerCase().includes('tidak diketahui'));
    const treatmentString = treatmentList.length > 0 ? treatmentList.join(', ') : 'Pijat Bayi/Moms';
    
    // Construct descriptive treatment_detail
    let detail = `${category === TreatmentCategory.BABY ? 'Baby' : category === TreatmentCategory.MOMS ? 'Moms' : 'Combination'}: ${treatmentString}`;
    if (parsedPatients.length > 0) {
      const patientSummary = parsedPatients.map(p => `${p.name}${p.ageText ? ` (${p.ageText})` : ''}`).join(' & ');
      detail += ` (Pasien: ${patientSummary})`;
    }

    // Check if reservation exists for this customer around booking date or by treatment_detail
    const existingRes = customer.reservations?.find(r => {
      if (r.booking_date && Math.abs(r.booking_date.getTime() - bookingDate.getTime()) < 24 * 3600 * 1000) {
        return true;
      }
      if (r.treatment_detail && treatmentList.some(t => r.treatment_detail?.toLowerCase().includes(t.toLowerCase()))) {
        return true;
      }
      return false;
    });

    if (existingRes) {
      // Enrich existing reservation
      const resUpdates: any = {};
      if ((!existingRes.purchase_value || existingRes.purchase_value === 0) && purchaseVal) {
        resUpdates.purchase_value = purchaseVal;
      }
      if (existingRes.status === 'pending') {
        resUpdates.status = 'completed';
      }
      if (item.order_index > 1) {
        resUpdates.is_repeat_order = true;
      }
      if (Object.keys(resUpdates).length > 0) {
        await prisma.reservation.update({
          where: { id: existingRes.id },
          data: resUpdates
        });
        reservationsUpdated++;
      }
    } else {
      // Create new reservation
      await prisma.reservation.create({
        data: {
          tenant_id: tenantId,
          customer_id: customer.id,
          treatment_category: category,
          treatment_detail: detail,
          booking_date: bookingDate,
          raw_text: item.notes ? `[EXPORT] ${item.notes}` : `[EXPORT] Order #${item.order_index}`,
          status: 'completed',
          purchase_value: purchaseVal,
          purchase_review_status: 'pending',
          is_repeat_order: item.order_index > 1,
        }
      });
      reservationsCreated++;
    }
  }

  console.log(`=== SYNC COMPLETE ===`);
  console.log(`Customers Created: ${customersCreated}, Updated: ${customersUpdated}`);
  console.log(`Children Upserted: ${childrenUpserted}`);
  console.log(`Reservations Created: ${reservationsCreated}, Updated: ${reservationsUpdated}`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  syncAndEnrichExportData(prisma)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
