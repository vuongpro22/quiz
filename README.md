# Bo cong cu OCR de thi PMG (Python)

Du an gom: quet anh thanh text (`ocr_scan.py`), crop anh quiz man hinh (`auto_crop_questions.py`), chuan hoa text (`normalize_ocr_text.py`), lam bai quiz / flashcard (`quiz_gui.py`, `quiz_app.py`).

---

## 1. Chuan bi

### 1.1 Python va thu vien

```bash
cd "c:\Users\binhv\Desktop\test"
pip install -r requirements.txt
```

### 1.2 Tesseract OCR (bat buoc)

- Cai Tesseract cho Windows: [UB-Mannheim Tesseract Wiki](https://github.com/UB-Mannheim/tesseract/wiki)
- Khi cai, chon them ngon ngu **Vietnamese (`vie`)** va **English (`eng`)** neu de tieng Anh.

Neu lenh `tesseract` khong co trong PATH, moi lenh OCR duoi day them:

```text
--tesseract-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

---

## 2. Hai kieu anh de (co crop / khong crop)

| Kieu | Dac diem | Can crop? |
|------|-----------|-----------|
| **A - anh de sach** | Chi co cau hoi + dap an, ten file kieu `Q1.webp`, `Q2.webp`, khong watermark web | **Khong** - OCR truc tiep thu muc `img\...` |
| **B - anh chup man hinh quiz** | Co thanh tren/duoi, watermark (`fuoverflow`...), vach do chia cot, nut Back/Next | **Co** - chay `auto_crop_questions.py` truoc, OCR thu muc `img_cropped\...` |

---

## 3. Luong A - Khong can crop (anh de chuan)

1. Dat anh vao thu muc, vi du: `img\PMG201c - FA25 - FE\` voi ten `Q1.webp` ... `Q50.webp`.
2. Chay OCR:

```powershell
python ocr_scan.py "img\PMG201c - FA25 - FE" --tesseract-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe" -o "output_text"
```

3. Ket qua: **mot file gop** trong `output_text`, ten = **ten thu muc** + `.txt`, vi du `PMG201c - FA25 - FE.txt`.

Tuy chon thuong dung:

- `-o "output_text"` - thu muc chua file text.
- `--psm 6` - mac dinh; thu `--psm 4` neu bo cuc la.
- `--no-preprocess` - tat xu ly anh (thu khi anh da rat sach).
- `--save-individual` - them file `.txt` tung anh (mac dinh **chi** file gop).

---

## 4. Luong B - Can crop (screenshot quiz)

### 4.1 Crop truoc khi OCR

Script `auto_crop_questions.py` tim **vach do doc**, giu vung cau hoi + dap an (va co the giu dai trai co chu `(Choose 1 answer)`).

```powershell
python auto_crop_questions.py "img\PMG201c - SU25 - RE" -o "img_cropped\PMG201c - SU25 - RE" --include-left 420 --top-cut 30 --footer-cut 90
```

Tham so goi y:

- `--include-left 420` - pixel giu ben trai vach do (co dong Choose...).
- `--top-cut 30` - cat phan header rac phia tren (tang/giam neu van dinh chu thua).
- `--footer-cut 90` - cat thanh duoi (Back/Next).

### 4.2 OCR sau khi crop

```powershell
python ocr_scan.py "img_cropped\PMG201c - SU25 - RE" --tesseract-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe" -o "output_text" --psm 6
```

File gop: `output_text\PMG201c - SU25 - RE.txt` (theo ten thu muc input).

---

## 5. Chuan hoa text sau OCR (tuy chon)

Khi nhieu bo de format khac nhau (watermark, `(Choose 1 answer)` dinh dong...), co the chuan hoa ve cung mot kieu:

```powershell
python normalize_ocr_text.py "output_text" --in-place
```

Hoac ghi ra thu muc moi (khong ghi de ban goc):

```powershell
python normalize_ocr_text.py "output_text" -o "output_text_normalized"
```

---

## 6. Doi ten anh kieu `(0)`, `(1)` -> `Q1`, `Q2`

Neu anh tai ve co ten dang `...(0).webp`, `...(1).webp` (Windows sort sai thu tu), doi thu cong hoac dung PowerShell (vi du da dung trong project):

- `(0)` -> `Q1.webp`, `(1)` -> `Q2.webp`, ... `(49)` -> `Q50.webp`.

Sau do chay OCR nhu luong A.

---

## 7. File dap an cho Quiz

- **`.txt`** - moi dong: `Q1: A`, `Q18: A, B`, ...
- **`.csv`** - cot dap an theo dong (dong 1 header, tu dong 2 = Q1, Q2...); app doc cot dau co noi dung.

Trong `quiz_gui.py`: chon file de (merged `.txt` trong `output_text`) va file dap an (`.txt` hoac `.csv`).

```powershell
python quiz_gui.py
```

- **Load Quiz** - lam bai, cham diem.
- **Flashcard Mode** - xem cau, bat/tat dap an.

Phien ban dong lenh:

```powershell
python quiz_app.py --questions "output_text\PMG201c - FA25 - RE.txt" --answers "answer\PMG201c - FA25 - RE.txt"
```

---

## 8. Tom tat lenh nhanh

| Muc dich | Lenh |
|----------|------|
| OCR thu muc de (khong crop) | `python ocr_scan.py "img\<TenDe>" -o "output_text" --tesseract-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe"` |
| Crop roi OCR | `auto_crop_questions.py` -> `ocr_scan.py` vao `img_cropped\...` |
| Chuan hoa toan bo output | `python normalize_ocr_text.py "output_text" --in-place` |
| Mo quiz GUI | `python quiz_gui.py` |

---

## 9. Ghi chu

- Duong dan co **dau cach** (vi du `PMG201c - FA25 - FE`) luon dat trong dau ngoac kep.
- Chat luong OCR phu thuoc anh goc: crop + `--psm` + normalize giup dong bo format, khong thay the anh qua mo hoac qua nho.

```bash
python normalize_ocr_text.py ".\output_text\PMG201c - FA 2024 - FE.txt" 

python ocr_scan.py "img_cropped\PMG201c - FA 2024 - FE" --tesseract-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe" --psm 4 -o "output_text"

python auto_crop_questions.py "img\PMG201c - FA 2024 - RE" -o "img_cropped\PMG201c - FA 2024 - RE" --include-left 450 --top-cut 80

python quiz_gui.py

```