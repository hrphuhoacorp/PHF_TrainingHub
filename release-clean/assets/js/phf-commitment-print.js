(function(){
'use strict';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));
const blank = '........................................';
const value = input => esc(String(input ?? '').trim() || blank);
const pathId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

let record = null;
try {
  record = JSON.parse(sessionStorage.getItem('phfBmttPrintRecord:' + pathId) || 'null');
} catch (error) {
  record = null;
}

function complete(r){
  return !!(
    r && r.id &&
    (r.employeeId || r.employee_id) &&
    (r.confirmedName || r.signName || r.fullName) &&
    (r.confirmedByEmail || r.accountEmail) &&
    (r.confirmedAt || r.signedAt) &&
    r.documentVersion &&
    r.acknowledgementText
  );
}

function dateObject(input){
  if(!input) return null;
  const raw = String(input).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T00:00:00' : raw;
  const result = new Date(iso);
  return Number.isNaN(result.getTime()) ? null : result;
}

function formatDate(input){
  const d = dateObject(input);
  if(!d) return '';
  return String(d.getDate()).padStart(2,'0') + '/' +
    String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}

function splitDate(input){
  const d = dateObject(input) || new Date();
  return {
    day: String(d.getDate()).padStart(2,'0'),
    month: String(d.getMonth()+1).padStart(2,'0'),
    year: String(d.getFullYear())
  };
}

function fail(message){
  document.getElementById('phfPrintRoot').innerHTML =
    '<div style="max-width:620px;margin:80px auto;padding:28px;border:1px solid #ddd;border-radius:12px;font-family:Arial,sans-serif">' +
    '<h1 style="font-size:22px">Không mở được bản cam kết</h1>' +
    '<p>' + esc(message) + '</p>' +
    '<button onclick="window.close()" style="padding:9px 16px">Đóng trang</button></div>';
}

function render(r){
  const fullName = r.confirmedName || r.signName || r.fullName;
  const confirmationDate = r.confirmDate || r.confirmedAt || r.signedAt;
  const d = splitDate(confirmationDate);
  const checkedCount = Number(r.checkedCount || 1);
  const requiredCheckCount = Number(r.requiredCheckCount || 1);
  const account = r.confirmedByEmail || r.accountEmail;
  const serverTime = dateObject(r.confirmedAt || r.signedAt);
  const serverTimeText = serverTime ? serverTime.toLocaleString('vi-VN') : blank;

  document.title = 'Bản cam kết bảo mật thông tin - ' + fullName + ' - PHUHOA FRESH';
  document.getElementById('phfPrintRoot').innerHTML = `
  <div class="doc">
    <div class="national">
      CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br>
      <span class="sub">Độc lập – Tự do – Hạnh phúc</span>
    </div>
    <div class="line">--------o0o--------</div>
    <h1>BẢN CAM KẾT BẢO MẬT THÔNG TIN</h1>
    <div class="subtitle">(V/v: Cam kết bảo mật thông tin &amp; trách nhiệm vật chất)</div>

    <p>Căn cứ quy định tại Bộ luật lao động 2019;</p>
    <p>Căn cứ quy định tại Bộ luật hình sự 2015 (sửa đổi 2017) về tội xâm nhập trái phép, chiếm đoạt, làm lộ thông tin bí mật kinh doanh;</p>
    <p>Để bảo đảm quyền lợi hợp pháp của Công ty;</p>
    <p>Hôm nay, ngày <b>${value(d.day)}</b> tháng <b>${value(d.month)}</b> năm <b>${value(d.year)}</b>, Tại: Công Ty cổ phần thực phẩm Phú Hòa, Chúng tôi gồm:</p>

    <div class="party-title">BÊN A: (Người sử dụng lao động):</div>
    <p>Bà: <b>Trần Thu Thủy</b></p>
    <p>Chức vụ: <b>Giám Đốc</b></p>
    <p>Đại diện cho (1): <b>CÔNG TY CỔ PHẦN THỰC PHẨM PHÚ HÒA</b></p>
    <p>Mã số thuế: <b>3703182824</b></p>
    <p>Địa chỉ trụ sở chính: <b>342 Phú Lợi, Phường Phú Lợi, TP. Hồ Chí Minh.</b></p>
    <p>(Sau đây gọi là “Công ty”)</p>

    <div class="party-title">Bên B: (Người lao động)</div>
    <div class="info-grid">
      <div>Ông (Bà): <b>${value(fullName)}</b></div>
      <div>Sinh ngày: <b>${value(formatDate(r.birthday))}</b></div>
      <div>Số CCCD: <b>${value(r.cccd)}</b></div>
      <div>Cấp ngày: <b>${value(formatDate(r.cccdDate))}</b></div>
      <div class="full">Tại: <b>${value(r.cccdPlace)}</b></div>
      <div>Số điện thoại xác nhận: <b>${value(r.phone || r.signPhone)}</b></div>
      <div>Vị trí/Bộ phận: <b>${value(r.position)}</b></div>
      <div>Chi nhánh/Bộ phận làm việc: <b>${value(r.branch)}</b></div>
    </div>
    <p>(Sau đây gọi là “Người lao động”)</p>
    <p>Sau khi trao đổi, hai bên thống nhất ký bản “cam kết bảo mật” này, qui định về trách nhiệm và cam kết bảo mật thông tin của Người lao động - với nội dung như sau:</p>

    <div class="section-title">Điều 1 : TÀI LIỆU/THÔNG TIN BẢO MẬT</div>
    <p><b>1.1</b> Bí mật kinh doanh và tài sản trí tuệ bao gồm nhưng không giới hạn: được hiểu là các thông tin, tài liệu thể hiện hoặc lưu trữ dưới các dạng như: văn bản, file máy tính, thư điện tử, hình ảnh, mã code, phần mềm tin học mà Công ty có được và thuộc quyền sở hữu hợp pháp của mình.</p>
    <p>Bí mật kinh doanh và tài sản trí tuệ còn được hiểu và thực hiện theo quy định hiện hành của pháp luật Việt Nam và thông lệ Quốc tế (trong trường hợp pháp luật Việt Nam chưa có quy định)</p>
    <p><b>1.2.</b> Thông tin bảo mật: là những thông tin thuộc Bí mật kinh doanh và tài sản trí tuệ nêu tại Điều 1.1 mà Người lao động trong quá trình làm việc tại Công ty biết được hoặc tiếp cận được.</p>
    <p><b>1.3.</b> Phù hợp với các quy định ở trên, Công ty quy định những thông tin, tài liệu sau đây là tài sản của Công ty, cần được bảo mật và giữ gìn vì quyền và lợi ích hợp pháp của Công ty:</p>
    <ul>
      <li>Danh sách khách hàng, thông tin khách hàng.</li>
      <li>Thông tin về đối tác, nhà cung cấp, thoả thuận hợp tác.</li>
      <li>Sổ sách tài chính kế toán, chứng từ ngân hàng.</li>
      <li>Hệ thống các phần mềm cài đặt trên máy vi tính của Công ty.</li>
      <li>Các tài liệu về tình hình tài chính của công ty (Doanh số, khoản vay, nợ, phải thu,..,).</li>
      <li>Hệ thống các phần mềm, quy trình, dữ liệu.</li>
      <li>Kế hoạch/ý tưởng/báo cáo/chiến lược hoạt động kinh doanh.</li>
      <li>Tài liệu mô tả, phân tích thiết kế hệ thống, phần mềm, tài liệu hướng dẫn và các tài liệu được phổ biến nội bộ.</li>
      <li>Khóa mã bản quyền các phần mềm sử dụng trong Công ty.</li>
      <li>Ghi chú: Danh mục tài liệu/thông tin bảo mật nêu trên có thể được Công ty bổ sung vào bất kỳ lúc nào. Khi bổ sung sẽ thông báo cho Người lao động.</li>
    </ul>

    <div class="section-title">Điều 2 : CAM KẾT CỦA NGƯỜI LAO ĐỘNG</div>
    <ul>
      <li>Người lao động có trách nhiệm và cam kết bảo mật tất cả những tài liệu/thông tin bảo mật của Công ty - quy định và nêu tại Điều 1 Phụ lục này.</li>
      <li>Người lao động cam kết không tự ý sao chép, cung cấp, mua bán hoặc sử dụng những thông tin/tài liệu bảo mật cho bất kỳ ai, vì bất kỳ lý do và mục đích gì nếu không có sự đồng ý bằng văn bản của Công ty.</li>
      <li>Người lao động cam kết không đưa thông tin lên mạng bằng cách phát tán ảnh chụp màn hình phần mềm, một phần hoặc toàn màn hình hoặc bất cứ hành vi nào tiềm ẩn nguy cơ rò rỉ thông tin thông qua Internet.</li>
      <li>Trong trường hợp vi phạm cam kết này, ngoài việc phải chịu hình thức xử lý, kỷ luật như quy định của pháp luật, Người lao động còn phải bồi thường toàn bộ thiệt hại do hành vi vi phạm của mình gây ra theo quy định của pháp luật.</li>
      <li>Trong trường hợp vi phạm cam kết này, mà vì lý do khách quan Công ty chưa đánh giá được mức độ thiệt hại và sự ảnh hưởng đến quyền lợi hợp pháp của Công ty thì tùy theo mức độ vi phạm, Người lao động đồng ý sẽ bị xử lý kỷ luật lao động đến mức cao nhất là sa thải (theo quy định trong Nội quy lao động) và phải có trách nhiệm bồi thường toàn bộ thiệt hại do mình gây ra cho công ty theo qui định của pháp luật.</li>
    </ul>

    <div class="section-title">Điều 3 : TRÁCH NHIỆM PHÁP LÝ</div>
    <ul>
      <li>Nếu hành vi vi phạm gây hậu quả nghiêm trọng (rò rỉ bí mật kinh doanh, dữ liệu khách hàng, chiến lược kinh doanh…), cá nhân vi phạm sẽ bị xử lý theo Bộ Luật Dân sự, Bộ Luật Lao động, Luật Sở hữu trí tuệ hoặc Bộ Luật Hình sự (tùy mức độ).</li>
      <li>Bồi thường thiệt hại cho doanh nghiệp theo Điều 130 Bộ Luật Lao động 2019.</li>
      <li>Bị xử phạt hành chính hoặc truy cứu trách nhiệm hình sự theo Điều 288, 289, 290 Bộ Luật Hình sự 2015 (sửa đổi 2017) về tội xâm nhập trái phép, chiếm đoạt, làm lộ thông tin bí mật kinh doanh.</li>
      <li>Mức phạt có thể lên đến 500 triệu đồng hoặc 3–7 năm tù, tùy mức độ thiệt hại và tính chất cố ý.</li>
    </ul>

    <div class="section-title">Điều 4 : ĐIỀU KHOẢN CHUNG</div>
    <ul>
      <li>Bản cam kết này là một bộ phận không tách rời của Hợp đồng lao động đã ký giữa hai bên, có giá trị trong suốt thời gian hiệu lực của hợp đồng lao động và vẫn có giá trị ràng buộc với bên B trong vòng 5 năm kể từ ngày hai bên chấm dứt hợp đồng lao động.</li>
      <li>Hai bên cam kết thực hiện đúng các điều khoản tại bản “cam kết bảo mật thông tin”. Mọi sự thay đổi, bổ sung chỉ có giá trị khi được cả hai bên đồng ý bằng văn bản.</li>
      <li>Người lao động cam kết hiểu rõ những nội dung qui định trong bản “cam kết bảo mật thông tin này”, tự nguyện cam kết và không khiếu nại về sau.</li>
      <li>Bản cam kết này có hiệu lực kể từ ngày ký, được lập thành 02 (hai) bản, có giá trị như nhau. Mỗi bên giữ 01 (một) bản.</li>
    </ul>

    <div class="electronic small">
      <b>Thông tin xác nhận trên hệ thống PHF Training Hub:</b><br>
      Người lao động đã tick đủ ${value(checkedCount)}/${value(requiredCheckCount)} ô xác nhận bắt buộc.
      Họ tên xác nhận: <b>${value(fullName)}</b>.
      Tài khoản xác nhận: <b>${value(account)}</b>.
      Thời gian máy chủ: <b>${value(serverTimeText)}</b>.
      Phiên bản cam kết: <b>${value(r.documentVersion)}</b>.
      Mã biên bản: <b>${value(r.id)}</b>.
    </div>

    <div class="sign-grid">
      <div class="sign-box">
        <div class="sign-title">NGƯỜI LAO ĐỘNG</div>
        <div class="small">(Đã xác nhận điện tử trên PHF Training Hub)</div>
        <br><br><br>
        <b>${value(fullName)}</b>
      </div>
      <div class="sign-box">
        <div class="sign-title">NGƯỜI SỬ DỤNG LAO ĐỘNG</div>
        <div class="small">(Ký, ghi họ tên và đóng dấu)</div>
        <br><br><br>
        <b>TRẦN THU THỦY</b>
      </div>
    </div>
  </div>`;

  setTimeout(function(){
    try { window.focus(); window.print(); } catch (error) {}
  }, 350);
}

const style = document.createElement('style');
style.textContent = `
  @page{size:A4 portrait;margin:15mm 14mm 15mm 14mm;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#fff;color:#000;}
  body{font-family:"Times New Roman",Times,serif;font-size:11.2pt;line-height:1.32;}
  .doc{width:100%;max-width:180mm;margin:0 auto;}
  .national{text-align:center;font-weight:700;line-height:1.25;margin-bottom:8px;}
  .national .sub{font-weight:400;}
  .line{text-align:center;margin:0 0 10px 0;}
  h1{font-size:15.5pt;line-height:1.15;text-align:center;margin:8px 0 2px;text-transform:uppercase;}
  .subtitle{text-align:center;font-weight:700;margin:0 0 10px 0;}
  p{margin:3px 0;}
  .section-title{font-weight:700;text-transform:uppercase;margin:8px 0 4px 0;}
  .party-title{font-weight:700;margin:6px 0 2px 0;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:14mm;row-gap:1mm;margin:4px 0 5px 0;}
  .info-grid div{min-width:0;overflow-wrap:anywhere;}
  .full{grid-column:1/-1;}
  ul{margin:3px 0 4px 16px;padding:0;}
  li{margin:2px 0;padding-left:2px;break-inside:avoid;}
  .sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:22mm;margin-top:16px;text-align:center;break-inside:avoid;page-break-inside:avoid;}
  .sign-box{min-height:36mm;}
  .sign-title{font-weight:700;text-transform:uppercase;}
  .small{font-size:10pt;}
  .electronic{border:1px solid #000;padding:6px 8px;margin:10px 0 4px 0;break-inside:avoid;page-break-inside:avoid;overflow-wrap:anywhere;}
  b{font-weight:700;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.doc{max-width:none;width:100%;}}
`;
document.head.appendChild(style);

if(!complete(record)){
  fail('Không tìm thấy bản ghi ký hoàn chỉnh trong phiên hiện tại. Vui lòng quay lại PHF Training Hub và bấm In biên bản từ hồ sơ đã ký.');
}else{
  render(record);
}
})();
