/* PHF Training Hub - Bản 27.6.3
 * Chấm điểm bài kiểm tra chính + bài kiểm tra ngắn bắt buộc.
 */
(function(){
  'use strict';
  var SHORT_TESTS={22:'short-gd1-review',42:'short-day1-afternoon',47:'short-step2-part1',50:'short-step2-part2',54:'short-step2-part3',58:'short-step2-part4',86:'short-gift-quick'};
  function notice(type,title,message){
    if(typeof window.phfNotice==='function') return window.phfNotice(type,title,message);
    if(typeof window.phfToast==='function') return window.phfToast(type||'info',title||'Thông báo',message||'');
  }
  function setButtonLoading(btn,on,text){
    if(typeof window.phfSetButtonLoading==='function') return window.phfSetButtonLoading(btn,on,text);
    if(!btn)return; if(on){btn.dataset.oldText=btn.textContent;btn.textContent=text||'Đang xử lý';btn.disabled=true}else{btn.textContent=btn.dataset.oldText||btn.textContent;btn.disabled=false;delete btn.dataset.oldText}
  }
  function currentIndex(){
    var x=Number(typeof window.phfCurrentLessonIndex!=='undefined'?window.phfCurrentLessonIndex:window.current);
    return Number.isFinite(x)?x:0;
  }
  function profile(){try{return typeof window.phfGetSavedProfile==='function'?(window.phfGetSavedProfile()||{}):JSON.parse(localStorage.getItem('phfEmployeeProfile')||'{}')}catch(e){return{}}}
  function today(){var d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
  function phfMarkQuizAnswers(questions,attrName){
    questions=Array.from(questions||[]);var total=questions.length,correct=0,missing=0,wrong=[];
    questions.forEach(function(q){
      q.classList.remove('phf-quiz-correct','phf-quiz-wrong','b3-correct','b3-incorrect','b4-correct','b4-incorrect','correct','wrong');
      var answer=q.getAttribute(attrName)||q.getAttribute('data-correct')||q.getAttribute('data-answer')||'';
      var checked=q.querySelector('input[type="radio"]:checked');
      if(!checked){missing++;wrong.push(q);q.classList.add('phf-quiz-wrong');return}
      if(String(checked.value).toLowerCase()===String(answer).toLowerCase()){
        correct++;q.classList.add('phf-quiz-correct','b3-correct','b4-correct','correct');
      }else{wrong.push(q);q.classList.add('phf-quiz-wrong','b3-incorrect','b4-incorrect','wrong')}
    });
    return{total:total,correct:correct,missing:missing,wrong:wrong,score:total?Math.round(correct/total*100):0};
  }
  function phfRenderQuizResult(el,stat,passScore){
    if(!el)return;var passed=Number(stat.score)>=(passScore||80);el.classList.remove('pass','fail','show');el.classList.add(passed?'pass':'fail','show');
    el.innerHTML='<b>'+(passed?'Đạt':'Chưa đạt')+' · '+stat.score+'/100 điểm</b><br>Đúng '+stat.correct+'/'+stat.total+' câu.'+(stat.missing?' · Còn '+stat.missing+' câu chưa chọn.':'')+(passed?'<br>Bạn có thể tiếp tục phần tiếp theo.':'<br>Vui lòng xem lại các câu chưa đúng/chưa chọn rồi chấm lại.');
  }
  function phfStoreQuizResult(key,stat){try{var list=JSON.parse(localStorage.getItem('phfQuizResults')||'[]');list.push({key:key,lessonIndex:currentIndex(),score:stat.score,correct:stat.correct,total:stat.total,savedAt:new Date().toISOString()});localStorage.setItem('phfQuizResults',JSON.stringify(list.slice(-80)))}catch(e){}}
  function gradeMain(selector,resultId,attr,key,btn,nextId){
    var root=document.getElementById('mainLesson');if(!root)return;var qs=Array.from(root.querySelectorAll(selector));var out=document.getElementById(resultId);
    if(!qs.length){notice('warning','Chưa tìm thấy câu hỏi','Chưa nhận được danh sách câu hỏi để chấm.');return}
    setButtonLoading(btn,true,'Đang chấm điểm...');setTimeout(function(){var stat=phfMarkQuizAnswers(qs,attr);phfRenderQuizResult(out,stat,80);if(nextId){var n=document.getElementById(nextId);if(n)n.style.display=stat.score>=80?'inline-flex':'none'}if(typeof window.phfStoreQuizResult==='function')window.phfStoreQuizResult(key,stat);setButtonLoading(btn,false)},80);
  }
  function convertGiftQuick(root){
    root.querySelectorAll('.b4-quiz').forEach(function(q,qi){
      if(q.querySelector('input[type="radio"]'))return;var ans=q.querySelector('.b4-answer');if(!ans)return;var m=(ans.textContent||'').match(/Đáp án đúng\s*:\s*([A-D])/i);if(!m)return;
      q.setAttribute('data-answer',m[1].toLowerCase());var p=q.querySelector('p');if(!p)return;ans.remove();var html=p.innerHTML.split(/<br\s*\/?\s*>/i);p.remove();
      html.forEach(function(line){var div=document.createElement('div');div.innerHTML=line;var txt=(div.textContent||'').trim();var mm=txt.match(/^([A-D])\.\s*(.*)$/i);if(!mm)return;var lab=document.createElement('label');lab.className='answer-choice';lab.innerHTML='<input type="radio" name="giftq'+qi+'" value="'+mm[1].toLowerCase()+'"> '+mm[2];q.appendChild(lab)});
      q.classList.add('phf-quiz-question');
    });
  }
  function injectShortCss(){if(document.getElementById('phf-required-short-quiz-css'))return;var s=document.createElement('style');s.id='phf-required-short-quiz-css';s.textContent='.phf-short-identity{display:grid;grid-template-columns:1fr 220px;gap:12px;margin:14px 0;padding:14px;border:1px solid #d7e7df;border-radius:14px;background:#f8fbf9}.phf-short-identity label{display:grid;gap:6px;color:#38594d;font-size:13px;font-weight:700}.phf-short-identity input{min-height:42px;border:1px solid #cfe1d8;border-radius:10px;padding:0 11px;background:#fff;color:#17382d}.phf-short-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0 4px}.phf-short-result{padding:12px 14px;border-radius:12px;background:#fff7e7;border:1px solid #efd59b;color:#704b00}.phf-short-result.pass{background:#eef8f2;border-color:#cde8d7;color:#17603f}.phf-short-locked input{pointer-events:none}.phf-short-locked{opacity:.82}.phf-short-wrong input:checked{outline:2px solid #bd3a3a}@media(max-width:680px){.phf-short-identity{grid-template-columns:1fr}}';document.head.appendChild(s)}

  function prepareStageReview(root,idx){
    if(Number(idx)!==22)return;
    var answerByName={nq1:'a',nq2:'b',nq3:'a',nq4:'a',nq5:'a',nq6:'a',tp1:'a',tp2:'a',tp3:'a',tp4:'a',tp5:'a',tp6:'a',vh1:'a',vh2:'a',vh3:'a',vh4:'a',vh5:'a',vh6:'a',vh7:'a'};
    root.querySelectorAll('.test-section .question-block').forEach(function(block){
      var radios=Array.from(block.querySelectorAll('input[type="radio"]'));
      if(!radios.length)return;
      var name=String(radios[0].name||'').trim();
      var answer=answerByName[name];
      if(!answer)return;
      block.classList.add('phf-quiz-question');
      block.setAttribute('data-answer',answer);
      radios.forEach(function(r,i){r.value=String.fromCharCode(97+i)});
    });
  }
  function stageReviewIdentity(root,idx){
    if(Number(idx)!==22)return null;
    var box=root.querySelector('.signature-xem,.signature-preview,.commit-signature');
    if(!box)return null;
    var name=box.querySelector('input[type="text"],input:not([type]),input[type="search"]');
    var date=box.querySelector('input[type="date"]');
    if(name){name.classList.add('phf-short-name');name.required=true;name.placeholder='Nhập họ và tên'}
    if(date){date.classList.add('phf-short-date');date.required=true}
    return box;
  }
  function validateStageReviewChecks(root,idx){
    if(Number(idx)!==22)return true;
    var checks=Array.from(root.querySelectorAll('.commit-final input[type="checkbox"]'));
    var missing=checks.filter(function(x){return !x.checked});
    if(missing.length){notice('warning','Chưa xác nhận đủ cam kết','Vui lòng tick đủ '+checks.length+' ô cam kết trước khi chấm và hoàn thành phần ôn tập.');try{missing[0].focus()}catch(e){}return false}
    return true;
  }
  function questionsFor(root){return Array.from(root.querySelectorAll('.phf-quiz-question[data-answer],.step2-question[data-correct],.b4-quiz[data-answer]'))}
  function setupShortQuiz(){
    var idx=currentIndex(),key=SHORT_TESTS[idx],root=document.getElementById('mainLesson');if(!key||!root)return;
    injectShortCss();if(idx===86)convertGiftQuick(root);prepareStageReview(root,idx);var qs=questionsFor(root);if(!qs.length)return;
    root.querySelectorAll('.test-note').forEach(function(n){n.innerHTML='<b>Yêu cầu:</b> Trả lời đủ và sửa đúng toàn bộ câu chưa đúng trước khi chuyển sang bài tiếp theo.'});
    var blue=root.querySelector('.bluebox p');if(blue)blue.textContent='Phần kiểm tra ngắn bắt buộc. Bạn cần trả lời đủ, sửa đúng toàn bộ câu chưa đúng và hoàn tất xác nhận trước khi chuyển sang bài tiếp theo.';
    var oldAction=root.querySelector('.phf-quiz-actions');if(oldAction)oldAction.remove();
    var first=qs[0],form=stageReviewIdentity(root,idx)||root.querySelector('.phf-short-identity');if(!form){
      form=document.createElement('div');form.className='phf-short-identity';form.innerHTML='<label>Họ và tên <span><input class="phf-short-name" type="text" required placeholder="Nhập họ và tên"></span></label><label>Ngày thực hiện <span><input class="phf-short-date" type="date" required></span></label>';first.parentNode.insertBefore(form,first);
    }
    var actions=root.querySelector('.phf-short-actions');if(!actions){actions=document.createElement('div');actions.className='phf-short-actions';actions.innerHTML='<button class="btn btn-primary phf-grade-short" type="button">Chấm bài kiểm tra ngắn</button><div class="phf-short-result" hidden></div>';var anchor=Number(idx)===22?(root.querySelector('.commit-final')||qs[qs.length-1]):qs[qs.length-1];anchor.insertAdjacentElement('afterend',actions)}
    var btn=actions.querySelector('.phf-grade-short'),out=actions.querySelector('.phf-short-result');if(btn.dataset.phfBound==='1')return;btn.dataset.phfBound='1';
    btn.addEventListener('click',function(){
      var name=(form.querySelector('.phf-short-name').value||'').trim(),date=form.querySelector('.phf-short-date').value||'';
      if(!name){notice('warning','Thiếu họ tên','Vui lòng nhập họ và tên trước khi chấm bài.');form.querySelector('.phf-short-name').focus();return}
      if(!date){notice('warning','Thiếu ngày thực hiện','Vui lòng chọn ngày thực hiện trước khi chấm bài.');form.querySelector('.phf-short-date').focus();return}
      if(!validateStageReviewChecks(root,idx))return;
      setButtonLoading(btn,true,'Đang chấm...');setTimeout(function(){
        var stat=phfMarkQuizAnswers(qs,'data-answer');
        qs.forEach(function(q){var checked=q.querySelector('input[type="radio"]:checked');var ans=(q.getAttribute('data-answer')||q.getAttribute('data-correct')||'').toLowerCase();var ok=checked&&String(checked.value).toLowerCase()===ans;q.classList.toggle('phf-short-locked',!!ok);q.classList.toggle('phf-short-wrong',!ok);q.querySelectorAll('input[type="radio"]').forEach(function(r){r.disabled=!!ok});if(!ok&&checked)checked.checked=false});
        out.hidden=false;out.classList.toggle('pass',stat.correct===stat.total&&stat.total>0);var nextText='';
        if(stat.missing){out.innerHTML='<b>Chưa đủ câu trả lời.</b><br>Vui lòng hoàn thành '+stat.missing+' câu còn thiếu rồi chấm lại.';nextText='Chấm lại các câu chưa hoàn thành'}
        else if(stat.correct<stat.total){out.innerHTML='<b>Kết quả: '+stat.correct+'/'+stat.total+' câu đúng.</b><br>Câu đúng đã được giữ lại. Vui lòng chọn lại các câu chưa đúng.';nextText='Kiểm tra lại các câu chưa đúng'}
        else{out.innerHTML='<b>Hoàn thành · 100/100 điểm.</b><br>Bạn đã trả lời đúng toàn bộ câu hỏi và có thể chuyển sang bài tiếp theo.';nextText='Đã hoàn thành';form.querySelectorAll('input').forEach(function(x){x.disabled=true});if(typeof window.phfMarkShortQuizCompleted==='function')window.phfMarkShortQuizCompleted(key,{score:100,correct:stat.total,total:stat.total},{fullName:name,date:date});if(typeof window.phfSaveProgressNow==='function')window.phfSaveProgressNow('short-quiz-pass')}
        setButtonLoading(btn,false);btn.textContent=nextText;if(stat.correct===stat.total&&stat.total>0)btn.disabled=true;
      },80)
    });
  }
  function phfBindLessonQuizScoring(){
    var s2=document.getElementById('gradeStep2Test');if(s2&&s2.dataset.phfBound!=='1'){s2.dataset.phfBound='1';s2.addEventListener('click',function(){gradeMain('.step2-question[data-correct]','step2TestResult','data-correct','step2-final',s2)})}
    var b3=document.getElementById('gradeB3Test');if(b3&&b3.dataset.phfBound!=='1'){b3.dataset.phfBound='1';b3.addEventListener('click',function(){gradeMain('.b3-mini[data-answer]','b3Result','data-answer','step3-final',b3,'goB3Complete')})}
    var b4=document.getElementById('gradeB4Final');if(b4&&b4.dataset.phfBound!=='1'){b4.dataset.phfBound='1';b4.addEventListener('click',function(){gradeMain('.b4-final-question[data-correct]','b4FinalResult','data-correct','step4-final',b4,'goB4Complete')})}
    setupShortQuiz();
  }
  window.phfMarkQuizAnswers=phfMarkQuizAnswers;window.phfRenderQuizResult=phfRenderQuizResult;window.phfStoreQuizResult=phfStoreQuizResult;window.phfBindLessonQuizScoring=phfBindLessonQuizScoring;window.PHF_checkDay1AfternoonQuiz=function(){var b=document.querySelector('.phf-grade-short');if(b)b.click()};
})();
