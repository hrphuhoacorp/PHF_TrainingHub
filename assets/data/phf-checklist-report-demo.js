(function(){
  'use strict';
  var people=[
    ['DEMO001','Nguyễn Minh Anh · Demo','Bán hàng','Nhân viên bán hàng','Phú Lợi'],
    ['DEMO002','Trần Hoài An · Demo','Bán hàng','Nhân viên bán hàng','Phú Lợi'],
    ['DEMO003','Lê Thanh Bình · Demo','Bán hàng','Trưởng ca bán hàng','Phú Lợi'],
    ['DEMO004','Phạm Gia Hân · Demo','Kế toán','Nhân viên kế toán','Phú Lợi'],
    ['DEMO005','Võ Minh Khang · Demo','Thu mua','Nhân viên thu mua','Phú Lợi'],
    ['DEMO006','Nguyễn Thảo My · Demo','Online','Nhân viên Online','Phú Lợi'],
    ['DEMO007','Trần Quốc Nam · Demo','Marketing','Nhân viên Marketing','Phú Lợi'],
    ['DEMO008','Lê Ngọc Phương · Demo','HCNS','Nhân viên HCNS','Phú Lợi'],
    ['DEMO009','Phạm Tuấn Kiệt · Demo','IT','Nhân viên IT','Phú Lợi'],
    ['DEMO010','Võ Bảo Châu · Demo','Bán hàng','Nhân viên bán hàng','Ngô Quyền'],
    ['DEMO011','Nguyễn Đức Duy · Demo','Bán hàng','Nhân viên bán hàng','Ngô Quyền'],
    ['DEMO012','Trần Khánh Hà · Demo','Bán hàng','Trưởng ca bán hàng','Ngô Quyền'],
    ['DEMO013','Lê Hoàng Lâm · Demo','Kho','Nhân viên kho','Ngô Quyền'],
    ['DEMO014','Phạm Bích Ngọc · Demo','Gói quà','Nhân viên gói quà','Ngô Quyền'],
    ['DEMO015','Võ Thành Phát · Demo','CSKH','Nhân viên CSKH','Ngô Quyền'],
    ['DEMO016','Nguyễn Yến Nhi · Demo','Bán hàng','Nhân viên bán hàng','Ngô Quyền'],
    ['DEMO017','Trần Minh Quân · Demo','Điều vận','Nhân viên điều vận','Ngô Quyền'],
    ['DEMO018','Lê Hải Anh · Demo','Bán hàng','Nhân viên bán hàng','Lái Thiêu'],
    ['DEMO019','Phạm Nhật Huy · Demo','Bán hàng','Nhân viên bán hàng','Lái Thiêu'],
    ['DEMO020','Võ Thu Trang · Demo','Bán hàng','Trưởng ca bán hàng','Lái Thiêu'],
    ['DEMO021','Nguyễn Quỳnh Chi · Demo','Kho','Nhân viên kho','Lái Thiêu'],
    ['DEMO022','Trần Gia Linh · Demo','Gói quà','Nhân viên gói quà','Lái Thiêu'],
    ['DEMO023','Lê Anh Tú · Demo','Kiểm soát nội bộ','Nhân viên kiểm soát','Lái Thiêu'],
    ['DEMO024','Phạm Kim Oanh · Demo','Hành chính','Nhân viên hành chính','Lái Thiêu']
  ];
  var issueGroups=['Nội quy và tác phong','Đi trễ','Trưng bày hàng hóa','Vệ sinh khu vực','Chất lượng / date hàng hóa','Bàn giao ca','Phối hợp công việc'];
  var months=['2026-06','2026-07','2026-08'],forms=[],violations=[];
  function round(v){return Math.round(v*100)/100;}
  months.forEach(function(month,mi){
    people.forEach(function(p,i){
      var checklist=Math.max(58,99-((i*7+mi*3)%27));
      var self=round(Math.max(62,88+mi*1.4-((i*5)%17)+(i%3)));
      var review=round(Math.max(58,self-((i%5)-1)*2.4-(i%7===0?8:0)));
      var finalScore=round((self+review*2)/3);
      var status='locked';
      if(mi===2){
        if(i===2||i===11)status='waiting_self';
        else if(i===6||i===17||i===22)status='waiting_review';
        else if(i===23)status='draft';
        else status=i%3===0?'locked':'reviewed';
      }
      var overdue=mi===2&&(i===2||i===6||i===17);
      var adminOverride=mi===2&&(i===5||i===18);
      var exception=mi===2&&(i===8||i===20);
      forms.push({
        id:'DEMO-F-'+month+'-'+p[0],periodMonth:month,employeeCode:p[0],employeeName:p[1],
        department:p[2],title:p[3],branch:p[4],status:status,checklistScore:checklist,
        selfTotalScore:self,reviewTotalScore:review,finalScore:['reviewed','locked'].indexOf(status)>=0?finalScore:null,
        overdue:overdue,adminOverride:adminOverride,exception:exception,
        reviewerName:p[4]==='Lái Thiêu'?'Quản lý LT · Demo':(p[4]==='Ngô Quyền'?'Quản lý NQ · Demo':'Quản lý PL · Demo')
      });
      var count=(i+mi)%4;
      for(var n=0;n<count;n++){
        var group=issueGroups[(i+n*2+mi)%issueGroups.length];
        violations.push({id:'DEMO-V-'+month+'-'+i+'-'+n,periodMonth:month,employeeCode:p[0],employeeName:p[1],department:p[2],branch:p[4],group:group,points:1+((i+n)%3),repeat:n>0||(i%6===0),occurredDate:month+'-'+String(5+((i*2+n*5)%23)).padStart(2,'0')});
      }
    });
  });
  var trainingSuggestions=[
    {topic:'Kiểm soát date hàng hóa',departments:['Kho','Bán hàng'],people:7,evidence:'12 lỗi trong 2 tháng · điểm tiêu chí 66%',priority:'high',action:'Đề xuất tạo lớp'},
    {topic:'Bàn giao ca đúng quy trình',departments:['Bán hàng'],people:6,evidence:'26% nhân sự chưa đạt · lặp lại 2 kỳ',priority:'high',action:'Đề xuất tạo lớp'},
    {topic:'Phối hợp và phản hồi công việc',departments:['Kế toán','Thu mua'],people:4,evidence:'7 tín hiệu liên phòng ban',priority:'medium',action:'Kèm cặp nhóm'},
    {topic:'Trưng bày hàng hóa',departments:['Bán hàng'],people:3,evidence:'Mới phát sinh trong tháng',priority:'watch',action:'Theo dõi thêm'}
  ];
  var reviewQuality=[
    {subject:'Phòng Kế toán',streak:'100% trong 4 kỳ',signals:7,confirmed:4,detail:'Tín hiệu chậm chứng từ, hóa đơn và đối soát',level:'review'},
    {subject:'Nguyễn Thảo My · Demo',streak:'100% trong 3 kỳ',signals:0,confirmed:0,detail:'Không có dữ liệu mâu thuẫn; đủ căn cứ ghi nhận',level:'good'},
    {subject:'Nhóm Bán hàng Ngô Quyền',streak:'83% phiếu từ 98–100 điểm',signals:5,confirmed:2,detail:'Mức điểm tập trung cao, nhận xét ít phân hóa',level:'calibrate'}
  ];
  var crossDepartmentSignals=[
    {department:'Kế toán',signals:7,sources:3,confirmed:4,topics:'Chậm chứng từ · hóa đơn · đối soát',result:'Điểm cao cần đối chiếu'},
    {department:'Kho',signals:6,sources:2,confirmed:4,topics:'Bàn giao · thiếu hàng · phản hồi chậm',result:'Cần xử lý'},
    {department:'Thu mua',signals:4,sources:2,confirmed:2,topics:'Tiến độ đặt hàng · phản hồi',result:'Theo dõi'},
    {department:'HCNS',signals:2,sources:1,confirmed:0,topics:'Phối hợp hồ sơ',result:'Chưa đủ cơ sở'}
  ];
  window.PHFChecklistReportDemo={isDemo:true,months:months,people:people,forms:forms,violations:violations,trainingSuggestions:trainingSuggestions,reviewQuality:reviewQuality,crossDepartmentSignals:crossDepartmentSignals,generatedAt:'2026-07-29T21:30:00+07:00'};
})();
