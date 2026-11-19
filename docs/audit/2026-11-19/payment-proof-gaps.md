# Audit Bukti Pembayaran — 2026-11-19

- Tenant: `default-tenant`
- Jendela audit: ±30 hari
- Total baris diperiksa: **152**
- Severity: HIGH **66**, MEDIUM **74**, LOW **12**

## Ringkasan per kode temuan

| Kode | Jumlah |
|---|---|
| MISSING_PROOF | 67 |
| PROOF_IN_PRUNABLE_STORAGE | 54 |
| PROOF_FILE_MISSING | 52 |
| AMOUNT_MISMATCH | 34 |
| PAID_WITHOUT_PROOF | 19 |

## Temuan HIGH

| Reservasi | Customer | Jadwal | Kode | Catatan |
|---|---|---|---|---|
| `a1a25975-ebcd-4124-90d7-5075f9fa4194` | Bunda Tri Yuli Astutik (6285731679991) | 2026-10-20T02:30:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `a039a535-91db-4d45-82da-0525f2b1423b` | Bunda Retno (6282132249740) | 2026-10-20T05:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `71f7eddc-1c7e-45b0-a0f7-f4ad772bdbd3` | Bunda Tere (6281233138008) | 2026-10-21T03:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `73a5af7b-fbdf-4964-b738-7955a2d98bcd` | Bunda Leliy (628113099991) | 2026-10-21T08:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `ed46bee3-580d-4a28-80fe-6c655b6f6f9c` | Bunda Savira (6285646819945) | 2026-10-21T09:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `17bec206-436e-4932-85f2-4df51ab62618` | Bunda Nurul Hidayati (6282146540499) | 2026-10-22T01:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `ba90c013-8fa4-4b7b-ab12-b2785bccb1af` | Bunda Jasmine (628133313187) | 2026-10-22T03:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `99e53bb2-94b5-4c6b-94c5-6edd253834a1` | Bunda Pamela (6281230755794) | 2026-10-22T04:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `86624d70-8946-4124-b340-9decd3863f26` | Bunda Devi (6285640652774) | 2026-10-22T06:30:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `26c4fc8f-c236-4514-8db3-fb387a707754` | Bunda Fellicia (6287852674363) | 2026-10-22T09:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `6dd463c6-5ab9-4502-8593-cffe9aeccc63` | Bunda Firda (628816336788) | 2026-10-22T09:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `1727eacc-81ef-4637-9631-1bcbb99727b4` | Bunda Suciani (6285878033569) | 2026-10-23T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `3b1d9592-2cc9-4806-8569-7a2cbdda5c75` | Bunda Dita (6285726099317) | 2026-10-24T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 10000 != tagihan Rp 90000. |
| `9bf7cd7f-829e-4b0a-a9d8-ce287d79b059` | Bunda Marisa (6285238124143) | 2026-10-24T05:30:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `a417630b-904e-414c-b73d-4b925ef50304` | Bunda Jennifer (628113399397) | 2026-10-24T06:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 95000 != tagihan Rp 120000. |
| `661ce39e-b456-4239-8b7a-aa140f0636db` | Bunda Sheilly (6285749345805) | 2026-10-24T08:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 235000 != tagihan Rp 250000. |
| `a045f0e1-9a2d-410d-a599-f8ecd16fc499` | Bunda Ayu (6281216571787) | 2026-10-25T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 79000 != tagihan Rp 100000. |
| `8bcb3d9e-f41e-4b83-8432-2609613bd801` | Bunda Sherly Mayshita (6285931048086) | 2026-10-25T11:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 165000 != tagihan Rp 170000. |
| `8d2de9ba-1631-4f62-acf6-9f05f96a5515` | Bunda Shendi Kharisma (6285725700714) | 2026-10-27T02:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `8690eec1-3e14-4b12-92ab-e66e9b971dd1` | Bunda Ella (6282234593428) | 2026-10-27T04:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 75000 != tagihan Rp 90000. |
| `fb150e10-b2df-4394-b808-fe1b65a4e935` | Linov (6281358343158) | 2026-10-27T05:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `6b6e7243-cec7-470e-a57f-c61ab2ba8e83` | Bunda Ayu (6281330708293) | 2026-10-28T02:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 85000 != tagihan Rp 100000. |
| `82868c35-fada-4de6-92dc-d0b72ea9375d` | Bunda Inna (6282132995805) | 2026-10-28T04:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `065b17af-5e3f-4948-8471-7bc9a14f0f95` | Bunda Gina (6285194925518) | 2026-10-29T08:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `6456461d-d039-4b20-82f6-bb55f190978d` | Bunda Vita (6282140771756) | 2026-10-30T03:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 175000 != tagihan Rp 85000. |
| `32a9b102-af68-4de8-8b1e-c092a69f9600` | Bunda Retno (6282132249740) | 2026-10-30T07:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `78e99dd5-8918-4bc4-a626-a54441fd83a6` | Bunda Tita (6281703396371) | 2026-10-31T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 75000 != tagihan Rp 65000. |
| `9ee18ee2-e333-4d58-a0d9-bf553e75e85f` | Bunda Haniyyah (6287788800765) | 2026-10-31T02:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 20000 != tagihan Rp 110000. |
| `94ff7219-a6ef-4607-8335-eb788b4f7d94` | Bunda Maisya (628980887940) | 2026-10-31T06:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 50000 != tagihan Rp 70000. |
| `7b972a30-fc03-428c-a07b-810408d96596` | Bunda Ananda (6285755550968) | 2026-11-01T06:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `80110511-726b-4b97-929b-b0b4b6cab142` | Bunda Yanti (6281803059159) | 2026-11-03T04:30:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `acbcf0cb-08cd-4a19-a963-e0dc85953c2b` | Bunda ifa (6281233771911) | 2026-11-04T04:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `1ded09e1-7ef9-49ae-8fc5-31d981b874b9` | Bunda putri (6281336693856) | 2026-11-04T08:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `5e3bfd2e-3319-4810-8db6-87e24ef3a161` | Bunda anjani (6281554555621) | 2026-11-04T10:00:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `3efa0479-41dc-4ee7-a0a1-c37689b2308c` | Bunda Misri (6282125207280) | 2026-11-05T05:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `b1fbe39f-82e5-4d4b-900f-619f4a4769e1` | Bunda eren (6285825061999) | 2026-11-05T07:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 70000 != tagihan Rp 75000. |
| `6904b3ed-1a9b-40fc-8939-004e6abc4459` | Bunda anisa♡ (6285790558616) | 2026-11-05T09:30:00.000Z | PROOF_FILE_MISSING | Berkas bukti tidak ditemukan di storage. |
| `bed87c13-727b-4cd7-910e-b530e891c466` | Bunda Khusnul (6285707077085) | 2026-11-06T01:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `b14afb4f-6c35-4b6b-a727-45e17ea64154` | Bunda briella (6283856165785) | 2026-11-06T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `ba4443dc-b574-4e18-be13-725953513b1f` | Bunda Dani (6281230771399) | 2026-11-06T02:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 185000 != tagihan Rp 220000. |
| `ae9deb7d-0712-4128-8bdf-0c0fdcc90493` | Bunda marthinasaaffira (6281249993675) | 2026-11-06T04:15:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `a52ac303-038a-4638-bec3-860fedce9ff5` | Nurmaya Dwi Fatmawati (6285645586423) | 2026-11-07T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 95000 != tagihan Rp 85000. |
| `2fff70f5-4fa9-4a9a-b5d7-ed7a89aace03` | Bunda Devita (6282231861906) | 2026-11-07T03:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 95000 != tagihan Rp 100000. |
| `e02ffbf7-9c97-4bf5-a19d-f184ac4d6e00` | Bunda Nanda Aisyah S (6281216664076) | 2026-11-07T04:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 95000 != tagihan Rp 80000. |
| `47f2b70e-cc0f-4819-adef-858327dc21af` | Bunda Irlandia Sahara (6287855852002) | 2026-11-08T02:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 64000 != tagihan Rp 70000. |
| `330b4cc4-e33b-4329-b1a6-dce83c579783` | Bunda Maria Ulfa (6282142041699) | 2026-11-08T08:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 85000 != tagihan Rp 80000. |
| `8532d9f5-045e-4a16-9a1b-a48cb7a35141` | Bunda erriza ayu sasqia n (6287752268149) | 2026-11-09T05:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 90000 != tagihan Rp 95000. |
| `fcc0b916-3b7d-4644-aa52-03093db37b49` | Bunda Indah (6285235657521) | 2026-11-09T06:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 85000 != tagihan Rp 105000. |
| `38277548-d473-4e5a-a7f2-123229bf0dcc` | Bunda Alfina (62895326778213) | 2026-11-10T06:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `bfb9c900-98c6-4f60-b745-53027734736e` | Bunda Gina (6285194925518) | 2026-11-10T08:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `b66046d2-c7a7-4f0f-82f3-fa300704593a` | Bunda Nara Little Ummaya Daycare (6281282572211) | 2026-11-11T08:00:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `277e1b1e-ce75-445d-9698-9fce9df1887f` | Bunda vika (6289614994536) | 2026-11-12T02:30:00.000Z | PROOF_FILE_MISSING, PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Berkas bukti tidak ditemukan di storage. Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 95000 != tagihan Rp 115000. |
| `bee0641d-a697-483c-9adf-c137e98ff802` | Bunda sintha erika (6285852555576) | 2026-11-14T11:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE | Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `37e511e5-9e6f-4421-a51e-2c3a7150ccec` | Bunda Kristi (6281383839061) | 2026-11-15T02:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 200000 != tagihan Rp 190000. |
| `7d63447f-3dfc-433b-b74b-fbe80e5d7631` | Bunda azizah (628175175696) | 2026-11-15T02:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 135000 != tagihan Rp 155000. |
| `e1236d2f-5571-4941-b5fb-cdb93bc775d6` | Bunda Eka (6282331923962) | 2026-11-15T05:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 180000 != tagihan Rp 170000. |
| `bbd3b28f-8526-4d85-a580-72a65ba96bc2` | Bunda Dhea (6282333353300) | 2026-11-16T02:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE | Bukti berada di folder inbound (retensi media chat, default 30 hari). |
| `88e9fdeb-2efd-4e14-a1a9-89fb9c704361` | Bunda Maisya (628980887940) | 2026-11-16T04:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 90000 != tagihan Rp 120000. |
| `1bdced24-eac4-4f11-a219-9d2c01f9fa5b` | Bunda Indy (6282245776662) | 2026-11-16T06:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 80000 != tagihan Rp 45000. |
| `8da1f7e0-26a2-4dcf-8069-71bcdd1ec601` | Bunda Lily (628113339009) | 2026-11-17T02:30:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 85000 != tagihan Rp 90000. |
| `e1316705-05c3-4f98-9da5-ec045b285979` | Bunda Intan (6285609075420) | 2026-11-17T04:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 80000 != tagihan Rp 90000. |
| `580d3cc7-9461-4682-8b2a-4b146c475604` | Bunda Amaliah Adnan (6285646767371) | 2026-11-17T04:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 150000 != tagihan Rp 145000. |
| `81281c04-8cd7-409b-9bb3-f1509de53d3e` | Bunda Hera (628113141111) | 2026-11-17T08:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 60000 != tagihan Rp 70000. |
| `df740399-2817-410e-bfe7-d7d580e480ff` | Bunda Jasmine (628133313187) | 2026-11-18T04:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 100000 != tagihan Rp 105000. |
| `61114c10-8d43-4603-b0da-f500816d5969` | Bunda Mery (6289667285350) | 2026-11-18T05:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE, AMOUNT_MISMATCH | Bukti berada di folder inbound (retensi media chat, default 30 hari). Nominal bukti Rp 85000 != tagihan Rp 75000. |
| `b3eb2c5c-a043-48d7-9163-d1326d97ca84` | Bunda eryca (628970425202) | 2026-11-19T02:00:00.000Z | PROOF_IN_PRUNABLE_STORAGE | Bukti berada di folder inbound (retensi media chat, default 30 hari). |

## Temuan MEDIUM

| Reservasi | Customer | Jadwal | Kode | Catatan |
|---|---|---|---|---|
| `1a20e5c6-9bb5-4cdb-8a54-6e46af354266` | Bunda Paw (6285121907558) | 2026-10-20T02:00:00.000Z | MISSING_PROOF |  |
| `0bbe5c1d-8978-480a-999b-07a84cce1ef4` | Bunda Hilda (6281938252933) | 2026-10-20T23:30:00.000Z | MISSING_PROOF |  |
| `549215ae-079e-4576-bb41-d3b34f5b668d` | Bunda Mareta (6282136569840) | 2026-10-23T02:00:00.000Z | MISSING_PROOF |  |
| `304b881f-6076-423e-a123-a5122f7e76c9` | Bunda Rafisa (6281234510381) | 2026-10-23T03:30:00.000Z | MISSING_PROOF |  |
| `882eb7f7-fc5f-45fc-b2f0-8fa137a08e0d` | Bunda Wulan (6287766559795) | 2026-10-23T04:30:00.000Z | MISSING_PROOF |  |
| `83c4ea0a-ab18-4a3e-a8bf-296ab09dd56a` | Bunda Megga (6281280800021) | 2026-10-23T06:30:00.000Z | MISSING_PROOF |  |
| `7272a340-86ac-4ecd-8a73-4e2448ce430d` | Bunda Mia (6282140706880) | 2026-10-23T08:00:00.000Z | MISSING_PROOF |  |
| `e473497b-b1ad-4155-97f9-b290481e0615` | Bunda Cynthia (6287757017472) | 2026-10-23T10:00:00.000Z | MISSING_PROOF |  |
| `2df19ab4-fa20-46ce-99b2-3255bebf0037` | Bunda Ririn (6281332636818) | 2026-10-25T07:30:00.000Z | MISSING_PROOF |  |
| `aed61ebe-5041-4f56-997b-93d066b7dff3` | Bunda briella (6283856165785) | 2026-10-26T02:00:00.000Z | MISSING_PROOF |  |
| `4ff5a218-9ee9-4433-8319-e8f54fe35dae` | Bunda Suami Eprill (62895368703065) | 2026-10-26T06:30:00.000Z | MISSING_PROOF |  |
| `ba6670bd-2d12-4612-bc58-ed713c2c032f` | Bunda Dina (6285816071628) | 2026-10-27T02:00:00.000Z | MISSING_PROOF |  |
| `77491eb6-74d2-4b60-a1de-5cffa36f6842` | Bunda Anggi Zulfika (6285604494724) | 2026-10-28T02:00:00.000Z | MISSING_PROOF |  |
| `671bc648-73c3-40bd-84b0-109e4656ac7d` | Bunda Annisa Radearilla (6281224281507) | 2026-10-28T03:30:00.000Z | MISSING_PROOF |  |
| `e6d057e5-83b5-433b-bb30-8dcb9f1c5a03` | Bunda Arum (6282111428977) | 2026-10-28T07:00:00.000Z | MISSING_PROOF |  |
| `1c8fcda2-0a99-4d81-8a6c-030ea7bec953` | Bunda Ervina (628815532550) | 2026-10-29T02:30:00.000Z | PAID_WITHOUT_PROOF | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. |
| `e96f929c-4969-410d-9b6e-538ac5d36eb0` | ulfiana (6289515768807) | 2026-10-29T05:30:00.000Z | MISSING_PROOF |  |
| `0d688caa-9927-4e8d-abc4-d5616c757f55` | Giscka Fadhilla (6281238738441) | 2026-10-29T08:00:00.000Z | MISSING_PROOF |  |
| `14176965-d7e6-4e38-8b20-5099acfb9f00` | Bunda Agnes (6288805704503) | 2026-10-30T02:00:00.000Z | MISSING_PROOF |  |
| `fa3949a3-a588-4498-9f31-74f03b636f82` | Bunda Kinnas Sofia Amaranggana (628133718453) | 2026-10-30T05:00:00.000Z | MISSING_PROOF |  |
| `1415fdc3-240a-476b-b644-de9ae127c920` | Bunda Agnes Noor Octavia Mulki Ridho (6289501211791) | 2026-10-31T03:30:00.000Z | MISSING_PROOF |  |
| `f87928bb-81eb-4dc3-a673-7906a221cee1` | Bunda Feriyal (6281217442171) | 2026-10-31T04:00:00.000Z | MISSING_PROOF |  |
| `656fd1fc-77ba-40f1-9158-a16e95bffd76` | Bunda Mutiara (6285117415425) | 2026-10-31T08:00:00.000Z | MISSING_PROOF |  |
| `3bc46713-ab02-4f39-88f2-37b293fc1e81` | Bunda Hindah (6287862784881) | 2026-11-01T02:00:00.000Z | MISSING_PROOF |  |
| `ad587990-f70d-43b9-9573-94732538ef5c` | Susi Setyowati (6285730657340) | 2026-11-01T02:00:00.000Z | MISSING_PROOF |  |
| `528891ad-2d4f-4015-93cf-ea717182976b` | Bunda Meta (6287855873973) | 2026-11-01T04:00:00.000Z | MISSING_PROOF |  |
| `2b07ecd4-ffca-4b74-b2ea-7b3461e2fa41` | Bunda Mutia (6288994572210) | 2026-11-01T05:30:00.000Z | MISSING_PROOF |  |
| `35785421-dcfb-4d6d-a43a-982eef338473` | Bunda Tety (62881081022666) | 2026-11-01T08:30:00.000Z | MISSING_PROOF |  |
| `278fe76c-53af-4488-977c-ca23b8f83939` | Bunda Zelikadewi (62881026768099) | 2026-11-02T02:00:00.000Z | MISSING_PROOF |  |
| `b603d8d7-13ad-41b2-b309-3075af41508a` | Bunda Raras (628563277980) | 2026-11-02T03:30:00.000Z | MISSING_PROOF |  |
| `d47551d9-a8d3-4a9e-a3f9-5a0c0d373601` | Bunda Nisamahardilla (6281330453185) | 2026-11-02T06:00:00.000Z | MISSING_PROOF |  |
| `d5a28a02-188d-4506-893f-13912acba54b` | Bunda Jennifer (628113399397) | 2026-11-02T07:30:00.000Z | MISSING_PROOF |  |
| `6afa71c2-e281-459e-8d7d-67c01fe8963a` | Bunda Devia (6285850166929) | 2026-11-03T01:30:00.000Z | PAID_WITHOUT_PROOF, AMOUNT_MISMATCH | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. Nominal bukti Rp 120000 != tagihan Rp 119000. |
| `2e186b28-1616-4da4-8346-4ecc0e44fc1a` | Bunda Threesa (6282272440944) | 2026-11-03T04:00:00.000Z | MISSING_PROOF |  |
| `a5328509-e022-4627-9850-0701a48a7c7c` | Bunda Leliy (628113099991) | 2026-11-03T08:00:00.000Z | PAID_WITHOUT_PROOF | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. |
| `7d4f4f5f-b032-4c2b-a28f-3304424f1314` | Bunda Rika (6281336055967) | 2026-11-04T02:30:00.000Z | MISSING_PROOF |  |
| `187412f1-0b4a-401c-b72a-1ba3cd1b3d3e` | Bunda Chris (6281390541340) | 2026-11-04T08:00:00.000Z | MISSING_PROOF |  |
| `6c8b70d1-4e9d-44af-96b9-ed3317a96501` | Bunda Pamela (6281230755794) | 2026-11-05T03:30:00.000Z | PAID_WITHOUT_PROOF, AMOUNT_MISMATCH | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. Nominal bukti Rp 90000 != tagihan Rp 115000. |
| `a8623bdf-acaa-4099-9a00-fc1db77552af` | Bunda Izza (6281210717420) | 2026-11-05T04:00:00.000Z | MISSING_PROOF |  |
| `0a2efa7f-58bc-4db1-994f-7adc1ec500cd` | Ferlin (628814362316) | 2026-11-05T08:00:00.000Z | MISSING_PROOF |  |
| `fcd93804-e6fc-45a0-a9d2-5997fbefd83f` | Bunda Nabila (6281336710270) | 2026-11-05T09:00:00.000Z | PAID_WITHOUT_PROOF | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. |
| `887a499c-d44f-4385-b1ca-7d2aaed8844a` | Bunda Diana (6282230422079) | 2026-11-06T03:00:00.000Z | MISSING_PROOF |  |
| `873f6311-a6b2-4abd-b1bb-f17e0c77d76d` | Bunda Laila (6289639926367) | 2026-11-06T05:00:00.000Z | MISSING_PROOF |  |
| `9e18cf6d-3942-4d3b-8ecc-163ebcdc130b` | Bunda Hida (6287815918787) | 2026-11-06T08:00:00.000Z | MISSING_PROOF |  |
| `9c7f67c1-ce22-4c97-a59e-959b75f3f8cc` | Bunda Nana (6282140090072) | 2026-11-07T03:00:00.000Z | MISSING_PROOF |  |
| `cc89ac4e-1d8a-48cb-872e-8f5b02715619` | Bunda Binti (6281228420441) | 2026-11-07T04:30:00.000Z | MISSING_PROOF |  |
| `3a22ffe0-8078-41d0-910c-ce877ea58b87` | Bunda Dian (6283849908005) | 2026-11-07T08:00:00.000Z | MISSING_PROOF |  |
| `1885892d-29fa-4d32-b88c-d5fa6ac60c1c` | Bunda Bella (6289670370062) | 2026-11-08T09:30:00.000Z | MISSING_PROOF |  |
| `c716315e-4fed-4c9f-bba1-18e47f5debc1` | Bunda Rizkaa (62881027627346) | 2026-11-09T02:00:00.000Z | MISSING_PROOF |  |
| `96d8d797-45dd-4e0d-9888-65227cad6718` | Bunda Riskaamana (6285238460006) | 2026-11-09T03:00:00.000Z | MISSING_PROOF |  |
| `f42fdc64-480f-4ba5-b50f-c892a202b704` | Bunda Jasmine (628133313187) | 2026-11-09T04:00:00.000Z | MISSING_PROOF |  |
| `efa35e22-8e4f-45ab-b464-25ce6aae3f2b` | Bunda Santiap (6289647551724) | 2026-11-09T06:00:00.000Z | PAID_WITHOUT_PROOF | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. |
| `f1082a30-c8bc-4ddf-8b61-6202ef3153ba` | Bunda Nina (6282246417630) | 2026-11-10T02:00:00.000Z | MISSING_PROOF |  |
| `c613d959-30e7-4922-ab40-b35aadb3d6c6` | Bunda Megga (6281280800021) | 2026-11-10T04:00:00.000Z | MISSING_PROOF |  |
| `e48e2b97-c24f-418b-aac6-2c898ffc33c3` | Bunda Putri (6282257242725) | 2026-11-11T03:00:00.000Z | MISSING_PROOF |  |
| `d737b077-ee73-4ff2-a823-49cddbee3398` | Bunda Himatus Suroyyah (6285733978283) | 2026-11-11T06:30:00.000Z | MISSING_PROOF |  |
| `3c12b852-a06a-424a-8421-d5a92c3cb531` | Bunda Intan (6287755713475) | 2026-11-13T00:00:00.000Z | MISSING_PROOF |  |
| `93756297-d2b2-4cec-9262-32f6e1f5029f` | Bunda Herlina (62895393651240) | 2026-11-14T04:00:00.000Z | MISSING_PROOF |  |
| `ccd9888c-ce25-40f4-8dd5-274636202a6b` | Bunda Vivi Sefnilasari (6281216792297) | 2026-11-14T06:30:00.000Z | MISSING_PROOF |  |
| `0975f422-4f19-43ef-b03e-7ee9d13d6f2c` | Bunda Nida (6285708211833) | 2026-11-17T01:00:00.000Z | MISSING_PROOF |  |
| `ee4366ab-737a-4aaf-81f1-b28861af5db3` | Bunda Ifa (6289675128793) | 2026-11-17T02:00:00.000Z | MISSING_PROOF |  |
| `cde6dc8b-7c9f-4390-a704-f59a47a4b8c2` | Bunda Gita (62881027888488) | 2026-11-18T02:00:00.000Z | MISSING_PROOF |  |
| `dcab31aa-54bb-4f55-83c1-fa6f8de5bd03` | Bunda sella (6282143712732) | 2026-11-18T06:00:00.000Z | MISSING_PROOF |  |
| `76f52ac9-e136-4033-9d07-556a7e045cc7` | Bunda Ikko Bella (6282145430901) | 2026-11-18T09:00:00.000Z | MISSING_PROOF |  |
| `0d07ad75-3088-435d-a7bb-f60cee064642` | Bunda Izza (6281210717420) | 2026-11-19T02:30:00.000Z | MISSING_PROOF |  |
| `81a30b43-2ce7-4751-90df-8f558172cd07` | Bunda Ayu (6281555475917) | 2026-11-19T03:30:00.000Z | MISSING_PROOF |  |
| `18e59296-f3f9-49b5-afb8-eef47294044d` | Bunda Yenny (6281336855888) | 2026-11-19T05:00:00.000Z | MISSING_PROOF |  |
| `36a453ed-6839-4f23-8d33-96f2692976ba` | Bunda Suami Eprill (62895368703065) | 2026-11-19T06:30:00.000Z | MISSING_PROOF |  |
| `0719494f-17bc-40e9-b7a6-1c5b56136c01` | Bunda Nuris (6285894174055) | 2026-11-19T07:00:00.000Z | MISSING_PROOF |  |
| `4a248eb8-7b96-4a79-9576-d79e8e55f031` | Kristina (6285236616268) | 2026-11-20T05:00:00.000Z | MISSING_PROOF |  |
| `968d2104-74bc-4952-ad74-9d6bfc81d3d7` | Bunda Maulida (628881626616) | 2026-11-21T02:30:00.000Z | MISSING_PROOF |  |
| `fd78dcf1-d54b-4f86-b76e-2f5444c8af5e` | Bunda aden (6281333548004) | 2026-11-22T02:30:00.000Z | MISSING_PROOF |  |
| `ab0cb3ac-3134-4157-b441-35c1db6f8ed6` | Bunda Kharisma Tria (6285190663780) | 2026-11-22T04:00:00.000Z | PAID_WITHOUT_PROOF | Tercatat lunas non-tunai tetapi tidak ada berkas bukti. |
| `de15ebda-689b-492c-b25a-af11546638e4` | Bunda Azalia W (6285230002359) | 2026-11-22T09:00:00.000Z | MISSING_PROOF |  |

> Skrip ini read-only. Tidak ada baris database yang diubah.
