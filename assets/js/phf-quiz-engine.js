/*
 * PHF Training Hub - Bản 25
 * Tách logic kiểm tra/thi ra file riêng.
 * File này chỉ giữ các hàm chấm điểm, hiển thị kết quả và bind nút kiểm tra trong bài học.
 * Không đổi thuật toán chấm điểm, không đổi ngưỡng đạt, không đụng Supabase/schema/server.
 */
(function(){
  'use strict';

  function notice(type, title, message){
    if(typeof window.phfNotice === 'function') return window.phfNotice(type, title, message);
    if(typeof window.phfToast === 'function') return window.phfToast(type || 'info', title || 'Thông báo', message || '');
  }

  function setButtonLoading(btn, isLoading, text){
    if(typeof window.phfSetButtonLoading === 'function') return window.phfSetButtonLoading(btn, isLoading, text);
    if(!btn) return;
    if(isLoading){ btn.dataset.oldText = btn.textContent; btn.textContent = text || 'Đang xử lý'; btn.disabled = true; }
    else{ btn.textContent = btn.dataset.oldText || btn.textContent; btn.disabled = false; delete btn.dataset.oldText; }
  }

  function phfMarkQuizAnswers(questions, attrName){
    questions = Array.from(questions || []);
    var total = questions.length, correct = 0, missing = 0;
    questions.forEach(function(q){
      q.classList.remove('phf-quiz-correct','phf-quiz-wrong','b3-correct','b3-incorrect','b4-correct','b4-incorrect','correct','wrong');
      var answer = q.getAttribute(attrName) || q.getAttribute('data-correct') || q.getAttribute('data-answer') || '';
      var checked = q.querySelector('input[type="radio"]:checked');
      if(!checked){ missing++; q.classList.add('phf-quiz-wrong'); return; }
      if(String(checked.value) === String(answer)){
        correct++;
        q.classList.add('phf-quiz-correct','b3-correct','b4-correct','correct');
      }else{
        q.classList.add('phf-quiz-wrong','b3-incorrect','b4-incorrect','wrong');
      }
    });
    return {total:total, correct:correct, missing:missing, score: total ? Math.round(correct/total*100) : 0};
  }

  function phfRenderQuizResult(el, stat, passScore){
    if(!el) return;
    stat = stat || {score:0, correct:0, total:0, missing:0};
    var passed = Number(stat.score) >= (passScore || 80);
    el.classList.remove('pass','fail','show');
    el.classList.add(passed ? 'pass' : 'fail','show');
    var missingText = stat.missing ? ' · Còn ' + stat.missing + ' câu chưa chọn.' : '';
    el.innerHTML = '<b>' + (passed ? 'Đạt' : 'Chưa đạt') + ' · ' + stat.score + '/100 điểm</b><br>Đúng ' + stat.correct + '/' + stat.total + ' câu.' + missingText + (passed ? '<br>Bạn có thể tiếp tục phần tiếp theo.' : '<br>Vui lòng xem lại các câu chưa đúng/chưa chọn rồi chấm lại.');
  }

  function phfStoreQuizResult(key, stat){
    try{
      var list = JSON.parse(localStorage.getItem('phfQuizResults') || '[]');
      var lessonIndex = (typeof window.phfCurrentLessonIndex !== 'undefined') ? window.phfCurrentLessonIndex : null;
      list.push({key:key, lessonIndex:lessonIndex, score:stat.score, correct:stat.correct, total:stat.total, savedAt:new Date().toISOString()});
      localStorage.setItem('phfQuizResults', JSON.stringify(list.slice(-80)));
    }catch(e){}
  }

  function phfGradeStep2Test(btn){
    var root = document.getElementById('mainLesson'); if(!root) return;
    var questions = Array.from(root.querySelectorAll('.step2-question[data-correct]'));
    var result = document.getElementById('step2TestResult');
    if(!questions.length){ notice('warning','Chưa tìm thấy câu hỏi','Chưa nhận được danh sách câu hỏi để chấm.'); return; }
    setButtonLoading(btn, true, 'Đang chấm điểm...');
    setTimeout(function(){
      var stat = phfMarkQuizAnswers(questions, 'data-correct');
      phfRenderQuizResult(result, stat, 80);
      if(typeof window.phfStoreQuizResult === 'function') window.phfStoreQuizResult('step2-final', stat);
      setButtonLoading(btn, false);
    }, 80);
  }

  function phfGradeB3Test(btn){
    var root = document.getElementById('b3Test') || document.getElementById('mainLesson'); if(!root) return;
    var questions = Array.from(root.querySelectorAll('.b3-mini[data-answer]'));
    var result = document.getElementById('b3Result');
    if(!questions.length){ notice('warning','Chưa tìm thấy câu hỏi','Chưa nhận được danh sách câu hỏi để chấm.'); return; }
    setButtonLoading(btn, true, 'Đang chấm điểm...');
    setTimeout(function(){
      var stat = phfMarkQuizAnswers(questions, 'data-answer');
      phfRenderQuizResult(result, stat, 80);
      var next = document.getElementById('goB3Complete');
      if(next) next.style.display = stat.score >= 80 ? 'inline-flex' : 'none';
      if(typeof window.phfStoreQuizResult === 'function') window.phfStoreQuizResult('step3-final', stat);
      setButtonLoading(btn, false);
    }, 80);
  }

  function phfGradeB4Final(btn){
    var root = document.getElementById('b4FinalTest') || document.getElementById('mainLesson'); if(!root) return;
    var questions = Array.from(root.querySelectorAll('.b4-final-question[data-correct]'));
    var result = document.getElementById('b4FinalResult');
    if(!questions.length){ notice('warning','Chưa tìm thấy câu hỏi','Chưa nhận được danh sách câu hỏi để chấm.'); return; }
    setButtonLoading(btn, true, 'Đang chấm điểm...');
    setTimeout(function(){
      var stat = phfMarkQuizAnswers(questions, 'data-correct');
      phfRenderQuizResult(result, stat, 80);
      var next = document.getElementById('goB4Complete');
      if(next) next.style.display = stat.score >= 80 ? 'inline-flex' : 'none';
      if(typeof window.phfStoreQuizResult === 'function') window.phfStoreQuizResult('step4-final', stat);
      setButtonLoading(btn, false);
    }, 80);
  }

  function phfBindLessonQuizScoring(){
    var root = document.getElementById('mainLesson'); if(!root) return;
    var step2 = document.getElementById('gradeStep2Test');
    if(step2 && step2.dataset.phfBound !== '1'){
      step2.dataset.phfBound='1';
      step2.addEventListener('click', function(){ phfGradeStep2Test(step2); });
    }
    var b3 = document.getElementById('gradeB3Test');
    if(b3 && b3.dataset.phfBound !== '1'){
      b3.dataset.phfBound='1';
      b3.addEventListener('click', function(){ phfGradeB3Test(b3); });
    }
    var b4 = document.getElementById('gradeB4Final');
    if(b4 && b4.dataset.phfBound !== '1'){
      b4.dataset.phfBound='1';
      b4.addEventListener('click', function(){ phfGradeB4Final(b4); });
    }
    var goB3 = document.getElementById('goB3Complete');
    if(goB3 && goB3.dataset.phfBound !== '1'){
      goB3.dataset.phfBound='1';
      goB3.addEventListener('click', function(){ if(typeof window.phfTryNextFromLesson === 'function') window.phfTryNextFromLesson(); });
    }
    var goB4 = document.getElementById('goB4Complete');
    if(goB4 && goB4.dataset.phfBound !== '1'){
      goB4.dataset.phfBound='1';
      goB4.addEventListener('click', function(){ if(typeof window.phfTryNextFromLesson === 'function') window.phfTryNextFromLesson(); });
    }
  }

  function PHF_checkDay1AfternoonQuiz(){
    var wrap = document.getElementById('day1AfternoonQuiz');
    if(!wrap) return;
    var questions = Array.from(wrap.querySelectorAll('.phf-quiz-question'));
    var correct = 0;
    questions.forEach(function(q){
      q.classList.remove('correct','wrong');
      var checked = q.querySelector('input[type="radio"]:checked');
      if(checked && checked.value === q.getAttribute('data-answer')){
        correct++;
        q.classList.add('correct');
      }else{
        q.classList.add('wrong');
      }
    });
    var result = document.getElementById('day1AfternoonQuizResult');
    if(result){
      result.classList.add('show');
      result.innerHTML = 'Bạn đã trả lời đúng ' + correct + '/' + questions.length + ' câu. Phần này không khóa bài; hãy đọc lại giải thích ở những câu chưa đúng rồi bấm tiếp tục.';
    }
  }

  window.phfMarkQuizAnswers = phfMarkQuizAnswers;
  window.phfRenderQuizResult = phfRenderQuizResult;
  window.phfStoreQuizResult = phfStoreQuizResult;
  window.phfGradeStep2Test = phfGradeStep2Test;
  window.phfGradeB3Test = phfGradeB3Test;
  window.phfGradeB4Final = phfGradeB4Final;
  window.phfBindLessonQuizScoring = phfBindLessonQuizScoring;
  window.PHF_checkDay1AfternoonQuiz = PHF_checkDay1AfternoonQuiz;
})();
