'use strict';
// Build CLEAN-UTF-8 TSV corpus for the payroll importer tests. Vietnamese
// headers are authored correctly here (the pasted docs lose CP1252 0x80-0x9F
// bytes); numeric data rows are transcribed verbatim from the Operator's files.
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'fixtures', 'payroll');
fs.mkdirSync(OUT, { recursive: true });
const J = (a) => a.join('\t');

// ---- T7 CANONICAL (87 business cols) ----
const T7_GROUP = [];
const put = (arr, i, v) => { arr[i] = v; };
[[0,'THÔNG TIN NHÂN SỰ'],[12,'PHỤ CẤP CÔNG VIỆC +THƯỞNG THEO HĐLĐ THEO CÔNG CHUẨN (TỔNG NGÀY TRONG THÁNG - OFF)'],
 [20,'TỔNG THU NHẬP THEO CÔNG VIỆC (1) + (2) + (3) +(4) + (5) + (6)+ (7) +(8) + (9)'],
 [21,'THỰC TẾ TRONG THÁNG (1)'],[24,'TĂNG CƯỜNG TRONG THÁNG (2)'],[27,'PHÉP TRONG THÁNG'],[31,'Lễ/ Tết (3)'],
 [34,'HIỆU QUẢ CÔNG VIỆC'],[36,'LƯƠNG CƠ BẢN (1)'],[38,'LƯƠNG TĂNG CƯỜNG (2)'],[40,'PHÉP'],[41,'LƯƠNG Lễ TẾT (3)'],[44,'KHÁC'],
 [46,'TỔNG LƯƠNG THEO CÔNG (1)'],[54,'TỔNG PHỤ CẤP (2)'],[55,'HIỆU QUẢ CÔNG VIỆC TRONG THÁNG'],
 [59,'TỔNG THƯỞNG HQCV + DT + HÀNH ĐỘNG (3)'],[60,'TỔNG LƯƠNG NGÀY CÔNG + PHỤ CẤP +THƯỞNG TRONG THÁNG (4) = (1) + (2) + (3)'],
 [61,'GIẢM TRỪ PHÁT SINH CÔNG VIỆC NỘI BỘ'],[65,'TỔNG GIẢM TRỪ NỘI BỘ (5)'],[66,'TỔNG THU NHẬP (4) - (5)'],
 [67,'KHOẢN GIẢM TRỪ'],[69,'TỔNG GIẢM TRỪ (6)'],[70,'TỔNG THU NHẬP SAU GIẢM TRỪ (TỔNG THU NHẬP - GIẢM TRỪ (6))'],
 [71,'THUẾ TNCN'],[75,'THỰC NHẬN SAU THUẾ'],[76,'HÌNH THỨC CHI'],[78,'SỐ TIỀN'],[80,'TÀI KHOẢN'],[82,'MAIL PHIẾU LƯƠNG'],[83,'Đối soát'],[85,'THƯỞNG T13 + DOANH THU']
].forEach(([i,v]) => put(T7_GROUP, i, v));

const T7_LABEL = ['STT','MST ĐÃ ĐỊNH DANH','MÃ NV','HỌ VÀ TÊN','CHI NHÁNH','MÃ HT','BẬC LƯƠNG',
 'NHÓM CÓ PHỤ CẤP NGHIỆP VỤ','NHÓM CÓ PHỤ CẤP QUẢN LÝ','LƯƠNG CƠ BẢN CÔNG/GIỜ THEO BHXH','PHỤ CẤP CÔNG VIỆC',
 'TỔNG CỘNG LƯƠNG CƠ BẢN THEO CÔNG CHUẨN (1)','HIỆU QUẢ CÔNG VIỆC (2)','NGHIỆP VỤ (3)','QUẢN LÝ (4)','CƠM (chuẩn 26 ngày) (5)',
 'NHÀ Ở (6)','XĂNG XE (7)','ĐIỆN THOẠI (8)','KHÁC (9)','','CÔNG/GIỜ ĐỊNH MỨC TRONG THÁNG','FT','PT','NGÀY THƯỜNG','NGÀY NGHỈ',
 'Lễ/ Tết','ĐẦU KỲ','DUYỆT PHÉP','PHÉP CÒN','NGHỈ KHÔNG LƯƠNG','NGHỈ Lễ/ Tết','ĐI LÀM Lễ/ Tết 800K','ĐI LÀM Lễ/ Tết 500K',
 'CÁ NHÂN','TẬP THỂ','LƯƠNG THỰC TẾ THEO CÔNG/ GIỜ FULLTIME','LƯƠNG THỰC TẾ GIỜ PART-TIME',
 'LƯƠNG TĂNG CƯỜNG THỰC TẾ GIỜ NGÀY THƯỜNG','LƯƠNG TĂNG CƯỜNG THỰC TẾ GIỜ NGÀY Lễ/TẾT','NGHỈ PHÉP THỰC TẾ TRONG THÁNG',
 'NGHỈ Lễ/ TẾT','LÀM Lễ/TẾT * 2','LÀM Lễ/TẾT','QUYẾT TOÁN PHÉP','TRAIN THỜI VỤ','','NGHIỆP VỤ (3)','QUẢN LÝ (4)',
 'CƠM (thực tế trong tháng) (5)','NHÀ Ở (6)','XĂNG XE (7)','ĐIỆN THOẠI (8)','khác','',
 'HIỆU QUẢ CÔNG VIỆC (không đánh giá T6 + T7 N2025)','DOANH THU/ CÔNG VIỆC','HÀNH ĐỘNG',
 'KHÁC (quy đổi lương Net, phát sinh trong tháng, đóng thay thuế TNCN)','','','QUỸ THĂM BỆNH','ĐI TRỄ','Xử ký phát sinh (nếu có)',
 'ỨNG LƯƠNG','','','BHXH','khác','','','Số NGƯỜI PHỤ THUỘC','THU NHẬP CHỊU THUẾ','THU NHẬP TÍNH THUẾ',
 'Số TIỀN CẦN ĐÓNG THUẾ TNCN','','TM','CK','TM','CK','STK','BANK'];
const T7_NUM = []; for (let i = 2; i <= 83; i++) T7_NUM[i] = String(i - 1);

// data rows (verbatim from T7 file): each is the 86-cell data array
const T7_DATA = [
'1\t074187006387\tPHF002\tTran Thu Thuy\tBan Giam doc\tE-6421-1\tQLCC-B4\tap dung\tap dung\t14000000\t1799999.9999999981\t15799999.999999998\t10533000.000000002\t1580000\t1580000\t910000\t\t\t\t\t30403000\t27\t27\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t100\tDat\t15800000\t0\t0\t0\t0\t0\t0\t\t\t\t15800000\t1580000\t1580000\t945000\t0\t0\t0\t0\t4105000\t10533000.000000002\t\t200000\t\t10733000\t30638000\t50000\t0\t\t0\t50000\t30588000\t1470000\t\t1470000\t29118000\t2\t29858000\t1958000\t97900\t29020100\t\tCK\t0\t29020100\t0281000592236\tVietcombank\t29020100\t0\t\t0',
'2\t051083007896\tPHF001\tHuynh Van Phong\tBan Giam doc\tE-6421-1\tQLCC-B4\tap dung\tap dung\t14000000\t1799999.9999999981\t15799999.999999998\t10533000.000000002\t1580000\t1580000\t910000\t\t\t\t\t30403000\t27\t27\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t100\tDat\t15800000\t0\t0\t0\t0\t0\t0\t\t\t\t15800000\t1580000\t1580000\t945000\t0\t0\t0\t0\t4105000\t10533000.000000002\t\t200000\t\t10733000\t30638000\t50000\t0\t\t0\t50000\t30588000\t1470000\t\t1470000\t29118000\t\t29858000\t14358000\t935800\t28182200\t\tCK\t0\t28182200\t9931191938\tVietcombank\t28182200\t0\t\t0',
'3\t019305009126\tPHF065\tNguyen Ha Vi\tPhong Ban Hang Lai Thieu\tD-6411-1\tKDTT-B1\t\t\t5700000\t\t5700000\t1375000\t0\t0\t910000\t\t\t\t\t7985000\t27\t28.998148148148147\t0\t7.5\t0\t0\t2\t0\t2\t0\t0\t0\t0\t96.5\tDat\t6121831.2757201651\t0\t262500\t0\t0\t0\t0\t\t438461.53846153844\t\t6822793\t0\t0\t1015000\t0\t0\t0\t0\t1015000\t1375000\t\t200000\t\t1575000\t9412793\t\t0\t\t0\t0\t9412793\t598500\t\t598500\t8814293\t\t8682793\t0\t0\t8814293\t\tCK\t0\t8814293\t1033617004\tvietcombank\t8814293\t0\t\t0',
'27\t079088019167\tPHF012\tLe Vinh Thang\tPhong Hanh Chinh Nhan Su\tE-6421-2\tNSGT-B6\tap dung\tap dung\t6000000\t3960000\t9960000\t4269000\t996000\t996000\t910000\t\t\t\t\t17131000\t27\t22\t0\t0\t0\t0\t1\t5\t0\t0\t0\t0\t0\t90\tDat\t8115555.555555555\t0\t0\t0\t1844444.4444444445\t0\t0\t\t\t\t9960000\t996000\t996000\t770000\t0\t0\t0\t0\t2762000\t4269000\t\t200000\t522500\t4991500\t17713500\t50000\t0\t\t0\t50000\t17663500\t0\t\t0\t17663500\t2\t17663500\t0\t0\t17663500\t\tCK\t0\t17663500\t19022000540018\t(TECHCOMBANK) Ky thuong Viet Nam\t17663500\t0\t\t0',
'26\t074074000527\tPHF036\tTran Trung Hai\tPhong Goi Qua\tD-6411-3\tNSGQ-B6\tap dung\tap dung\t6000000\t3350000.0000000037\t9350000.0000000037\t2337999.9999999963\t935000.00000000047\t935000.00000000047\t910000\t\t\t\t\t14468000\t27\t27\t0\t10.834000000000001\t0\t0\t4\t0\t4\t0\t0\t0\t0\t98.6\tDat\t9350000.0000000037\t0\t379190.00000000006\t0\t0\t0\t0\t\t\t\t9729190\t935000.00000000058\t935000.00000000058\t945000\t0\t0\t0\t0\t2815000\t2337999.9999999963\t\t200000\t\t2538000\t15082190\t50000\t0\t\t0\t50000\t15032190\t630000\t\t630000\t14402190\t1\t14302190\t0\t0\t14402190\t\tCK\t0\t14402190\t1062662581\tVietcombank\t14402190\t0\t\t0',
'6\t080198007326\tPHF046\tDang Ngoc Nhu Quynh\tPhong Ban Hang Lai Thieu\tD-6411-1\tKDTT-B4\tap dung\tap dung\t6000000\t1727500\t7727500\t1931500\t772750\t772750\t910000\t\t\t\t\t12114500\t27\t28.364444444444445\t0\t2\t0\t0\t4\t0\t4\t0\t0\t0\t0\t97.899999999999991\tDat\t8118009.0534979422\t0\t70000\t0\t0\t0\t0\t\t923076.92307692312\t\t9111086\t772750\t772750\t980000\t0\t0\t0\t0\t2525500\t1931500\t\t200000\t5133584\t7265084\t18901670\t\t0\t\t5000000\t5000000\t13901670\t630000\t\t630000\t13271670\t\t18171670\t2671670\t133584\t13138086\t\tCK\t0\t13138086\t1062644711\tVietcombank\t13138086\t0\t\t0',
'19\t074304006490\tPHF091\tPhan Thi Cam Tien\tPhong Ban Hang Phu Loi\tD-6411-1\tTV\t\t\t6800000\t0\t6800000\t\t0\t0\t\t\t\t\t\t6800000\t27\t30.998148148148147\t0\t0\t0\t0\t1\t0\t1\t0\t0\t0\t0\t0\tDat\t7806941.0150891626\t0\t0\t0\t0\t0\t0\t\t\t\t7806941\t0\t0\t0\t0\t0\t0\t0\t0\t0\t\t200000\t\t200000\t8006941\t\t0\t\t0\t0\t8006941\t0\t\t0\t8006941\t\t8006941\t\t\t8006941\t\tCK\t0\t8006941\t6505134407\t(BIDV) Dau tu va phat trien Viet Nam\t8006941\t0\t\t0',
];

// totals row (verbatim start)
const T7_TOTAL = '\t\t0\t0\t0\t0\t0\t0\t0\t281670000\t43455000\t325740000\t102939000\t16339750\t14771250\t36400000\t0\t500000\t0\t0\t496690000';

fs.writeFileSync(path.join(OUT, 'T7.tsv'),
  '﻿' + [
    'Ten don vi: CONG TY CO PHAN THUC PHAM PHU HOA',
    'Dia chi ... BANG TINH - THANH TOAN TIEN LUONG NHAN VIEN T07/2026',
    'MST: 3703182824',
    '',
    '\t\t\t\t\t\t\tCONG CHUAN THANG VH\t27',
    '\t\t\t\t\t\t\tCONG CHUAN THANG VP\t27',
    '',
    J(fill(T7_GROUP, 86)),
    J(fill(T7_LABEL, 82)),
    J(fill(T7_NUM, 84)),
    ...T7_DATA,
    '',
    T7_TOTAL,
  ].join('\n'), 'utf8');

function fill(a, n) { const o = []; for (let i = 0; i < n; i++) o[i] = a[i] == null ? '' : a[i]; return o; }

// ---- T1 (86 cols; different Lễ/Tết naming, no T13, "Thưởng lễ 1.1", "Đã chi 1.1") ----
const T1_GROUP = [];
[[0,'THÔNG TIN NHÂN SỰ'],[12,'PHỤ CẤP CÔNG VIỆC +THƯỞNG THEO HĐLĐ THEO CÔNG CHUẨN (TỔNG NGÀY TRONG THÁNG - OFF)'],
 [20,'TỔNG THU NHẬP THEO CÔNG VIỆC (1) + (2) + (3) +(4) + (5) + (6)+ (7) +(8) + (9)'],
 [21,'THỰC TẾ TRONG THÁNG (1)'],[24,'TĂNG CƯỜNG TRONG THÁNG (2)'],[27,'PHÉP TRONG THÁNG'],[31,'Lễ/ Tết (3)'],
 [33,'HIỆU QUẢ CÔNG VIỆC'],[35,'LƯƠNG CƠ BẢN (1)'],[37,'LƯƠNG TĂNG CƯỜNG (2)'],[39,'PHÉP'],[40,'LƯƠNG Lễ TẾT (3)'],[43,'KHÁC'],
 [45,'TỔNG LƯƠNG THEO CÔNG (1)'],[53,'TỔNG PHỤ CẤP (2)'],[54,'HIỆU QUẢ CÔNG VIỆC TRONG THÁNG'],
 [58,'TỔNG THƯỞNG HQCV + DT + HÀNH ĐỘNG (3)'],[59,'TỔNG LƯƠNG NGÀY CÔNG + PHỤ CẤP +THƯỞNG TRONG THÁNG (4) = (1) + (2) + (3)'],
 [60,'GIẢM TRỪ PHÁT SINH CÔNG VIỆC NỘI BỘ'],[64,'TỔNG GIẢM TRỪ NỘI BỘ (5)'],[65,'TỔNG THU NHẬP (4) - (5)'],
 [66,'KHOẢN GIẢM TRỪ'],[68,'TỔNG GIẢM TRỪ (6)'],[69,'TỔNG THU NHẬP SAU GIẢM TRỪ (TỔNG THU NHẬP - GIẢM TRỪ (6))'],
 [70,'THUẾ TNCN'],[74,'THỰC NHẬN SAU THUẾ'],[75,'HÌNH THỨC CHI'],[77,'SỐ TIỀN'],[79,'TÀI KHOẢN'],[81,'MAIL PHIẾU LƯƠNG'],[82,'Đối soát']
].forEach(([i,v]) => put(T1_GROUP, i, v));
const T1_LABEL = ['STT','MST ĐÃ ĐỊNH DANH','MÃ NV','HỌ VÀ TÊN','CHI NHÁNH','MÃ HT','BẬC LƯƠNG',
 'NHÓM CÓ PHỤ CẤP NGHIỆP VỤ','NHÓM CÓ PHỤ CẤP QUẢN LÝ','LƯƠNG CƠ BẢN CÔNG/GIỜ THEO BHXH','PHỤ CẤP CÔNG VIỆC',
 'TỔNG CỘNG LƯƠNG CƠ BẢN THEO CÔNG CHUẨN (1)','HIỆU QUẢ CÔNG VIỆC (2)','NGHIỆP VỤ (3)','QUẢN LÝ (4)','CƠM (chuẩn 26 ngày) (5)',
 'NHÀ Ở (6)','XĂNG XE (7)','ĐIỆN THOẠI (8)','KHÁC (9)','','CÔNG/GIỜ ĐỊNH MỨC TRONG THÁNG','FT','PT','NGÀY THƯỜNG','NGÀY NGHỈ',
 'Lễ/ Tết','ĐẦU KỲ','DUYỆT PHÉP','PHÉP CÒN','NGHỈ KHÔNG LƯƠNG','NGHỈ Lễ/ Tết','ĐI LÀM Lễ/ Tết',
 'CÁ NHÂN','TẬP THỂ','LƯƠNG THỰC TẾ THEO CÔNG/ GIỜ FULLTIME','LƯƠNG THỰC TẾ GIỜ PART-TIME',
 'LƯƠNG TĂNG CƯỜNG THỰC TẾ GIỜ NGÀY THƯỜNG','LƯƠNG TĂNG CƯỜNG THỰC TẾ GIỜ NGÀY Lễ/TẾT','NGHỈ PHÉP THỰC TẾ TRONG THÁNG',
 'NGHỈ Lễ/ TẾT','LÀM Lễ/TẾT','PHỤ TRỘI Lễ/ TẾT','QUYẾT TOÁN PHÉP','TRAIN THỜI VỤ','','NGHIỆP VỤ (3)','QUẢN LÝ (4)',
 'CƠM (thực tế trong tháng) (5)','NHÀ Ở (6)','XĂNG XE (7)','ĐIỆN THOẠI (8)','Thưởng lễ 1.1','',
 'HIỆU QUẢ CÔNG VIỆC (không đánh giá T6 + T7 N2025)','DOANH THU/ CÔNG VIỆC','HÀNH ĐỘNG',
 'KHÁC (quy đổi lương Net, phát sinh trong tháng, đóng thay thuế TNCN)','','','QUỸ THĂM BỆNH','ĐI TRỄ','Đã chi 1.1',
 'ỨNG LƯƠNG','','','BHXH','khác','','','Số NGƯỜI PHỤ THUỘC','THU NHẬP CHỊU THUẾ','THU NHẬP TÍNH THUẾ',
 'Số TIỀN CẦN ĐÓNG THUẾ TNCN','','TM','CK','TM','CK','STK','BANK'];
const T1_NUM = []; for (let i = 2; i <= 82; i++) T1_NUM[i] = String(i - 1);
const T1_DATA = [
'1\t070300003528\tPHF041\tDang Thi Diem\tPhong Ban Hang Lai Thieu\tD-6411-1\tKDTT-B2\tap dung\t\t5700000\t542500\t6242500\t1560500\t624250\t0\t910000\t\t\t\t\t9337250\t27\t28\t0\t17.332999999999998\t\t2.2999999999999998\t9\t0\t9\t0\t0\t1\t98.333333333333343\tDat\t6473703.7037037034\t0\t606655\t161000\t0\t0\t462407.40740740742\t\t\t\t7703766\t624250\t0\t1015000\t0\t0\t0\t0\t1639250\t1560500\t\t200000\t\t1760500\t11103516\t50000\t0\t0\t0\t50000\t11053516\t598500\t\t598500\t10455016\t\t10323516\t0\t0\t10455016\t\t\t10455016\t0\t1062396093\tVietcombank\t10455016\t0',
'26\t070087009691\tPHF005\tNguyen Minh Nhat\tPhong Kho & So Che\tD-6411-3\tCUNG-B4\tap dung\tap dung\t8430000\t0\t8430000\t2108000\t843000\t843000\t910000\t\t\t\t\t13134000\t27\t27\t0\t14.315000000000001\t\t0\t11\t0\t11\t0\t0\t1\t100\tDat\t8430000\t0\t501025.00000000006\t0\t0\t0\t624444.4444444445\t\t\t\t9555469\t843000\t843000\t980000\t0\t0\t0\t0\t2666000\t2108000\t\t200000\t\t2308000\t14529469\t50000\t0\t0\t0\t50000\t14479469\t0\t\t0\t14479469\t\t14479469\t\t\t14479469\t\t\t14479469\t0\t98999899999\t(TECHCOMBANK) Ky thuong Viet Nam\t14479469\t0',
'6\t034200014405\tPHF042\tNguyen Hoang Khang\tPhong Ban Hang Phu Loi\tD-6411-1\tKDTT-B2\t\t\t5700000\t542500\t6242500\t1560500\t0\t0\t910000\t\t\t\t\t8713000\t27\t28\t0\t11.716999999999999\t\t0\t8\t0\t8\t0\t0\t1\t94.466666666666669\tDat\t6473703.7037037034\t0\t410094.99999999994\t0\t0\t0\t462407.40740740742\t\t\t\t7346206\t0\t0\t1015000\t0\t0\t0\t0\t1015000\t1560500\t\t200000\t500000\t2260500\t10621706\t50000\t160000\t0\t1000000\t1210000\t9411706\t598500\t\t598500\t8813206\t\t9681706\t0\t0\t8813206\t\t\t8813206\t0\t9348641261\tVietcombank\t8813206\t0',
];
fs.writeFileSync(path.join(OUT, 'T1.tsv'),
  '﻿' + ['Ten don vi','... T01/2026','MST','','\t\t\t\t\t\t\tCONG CHUAN THANG VH\t27','\t\t\t\t\t\t\tCONG CHUAN THANG VP\t26','',
    J(fill(T1_GROUP, 86)), J(fill(T1_LABEL, 83)), J(fill(T1_NUM, 83)), ...T1_DATA].join('\n'), 'utf8');

console.log('corpus written:', fs.readdirSync(OUT).join(', '));
