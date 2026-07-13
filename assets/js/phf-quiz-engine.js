/* PHF Training Hub - Bản 1.0.5 - Bước 1
 * Chấm điểm bài kiểm tra chính + bài kiểm tra ngắn bắt buộc.
 * Trộn câu/đáp án theo lượt làm và chấm bằng ID đáp án ổn định, không phụ thuộc vị trí hiển thị.
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
    var candidates=[window.phfCurrentLessonIndex,window.current];
    for(var i=0;i<candidates.length;i++){
      var x=Number(candidates[i]);
      if(Number.isFinite(x)) return x;
    }
    return 0;
  }
  function profile(){try{return typeof window.phfGetSavedProfile==='function'?(window.phfGetSavedProfile()||{}):JSON.parse(localStorage.getItem('phfEmployeeProfile')||'{}')}catch(e){return{}}}
  function today(){var d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
  function learnerName(){var p=profile();return String(p.fullName||p.name||p.employeeName||p.displayName||'').trim()}
  function applyAutoIdentity(form){
    if(!form)return{fullName:'',date:today()};
    var fullName=learnerName(),date=today();
    var nameInput=form.querySelector('.phf-short-name'),dateInput=form.querySelector('.phf-short-date');
    if(nameInput){nameInput.value=fullName;nameInput.readOnly=true;nameInput.required=true;nameInput.setAttribute('aria-readonly','true');nameInput.placeholder='Tự động lấy từ hồ sơ'}
    if(dateInput){dateInput.value=date;dateInput.readOnly=true;dateInput.required=true;dateInput.setAttribute('aria-readonly','true')}
    form.classList.add('phf-short-identity-auto');
    return{fullName:fullName,date:date};
  }

  /*
   * PHF quiz shuffle:
   * - Chỉ đổi thứ tự hiển thị, không đổi value/data-answer/data-correct.
   * - Dùng seed lưu trong sessionStorage để cùng một lượt làm không bị đảo lại khi render/F5.
   * - Bài ngắn giữ nguyên thứ tự câu để học viên sửa câu sai; chỉ trộn đáp án.
   * - Bài thi chính trộn cả câu và đáp án.
   */
  function phfHash(text){
    var h=2166136261,s=String(text||'');
    for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return h>>>0;
  }
  function phfRng(seed){
    var a=(seed>>>0)||0x9e3779b9;
    return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296};
  }
  function phfShuffle(list,seed){
    var out=Array.from(list||[]),rnd=phfRng(seed);
    for(var i=out.length-1;i>0;i--){var j=Math.floor(rnd()*(i+1)),tmp=out[i];out[i]=out[j];out[j]=tmp}
    return out;
  }
  function phfAttemptSeed(quizKey){
    var p=profile(),who=p.employeeId||p.employee_id||p.email||p.phone||p.fullName||p.name||'guest';
    var storageKey='phfQuizAttemptSeed:'+String(who)+':'+currentIndex()+':'+String(quizKey||'quiz');
    try{
      var saved=sessionStorage.getItem(storageKey);
      if(saved)return Number(saved)>>>0;
      var seed=(Date.now()^(Math.floor(Math.random()*0xffffffff))^phfHash(storageKey))>>>0;
      sessionStorage.setItem(storageKey,String(seed));
      return seed;
    }catch(e){return phfHash(storageKey+':'+Date.now())}
  }
  function phfQuestionKey(q,index){
    var input=q&&q.querySelector&&q.querySelector('input[type="radio"]');
    return (input&&input.name)||q.getAttribute('data-question-id')||q.id||('q'+index);
  }
  function phfOptionNodes(q){
    if(!q || !q.querySelectorAll) return [];
    var nodes=[];
    Array.from(q.querySelectorAll('input[type="radio"]')).forEach(function(input){
      var node=input.closest('label') || input.parentElement;
      if(node && nodes.indexOf(node)<0) nodes.push(node);
    });
    if(nodes.length<2) return [];
    var parent=nodes[0].parentNode;
    if(!parent || nodes.some(function(node){return node.parentNode!==parent;})) return [];
    return nodes;
  }
  function phfApplyOptionOrder(nodes,ordered){
    if(!nodes.length || nodes.length!==ordered.length) return;
    var slots=nodes.map(function(node){var c=document.createComment('phf-option-slot');node.replaceWith(c);return c;});
    slots.forEach(function(slot,i){slot.replaceWith(ordered[i]);});
  }
  function phfCorrectValue(q){
    return String(q.getAttribute('data-answer') || q.getAttribute('data-correct') || '').trim().toLowerCase();
  }
  function phfShuffleAnswers(questions,quizKey){
    questions=Array.from(questions||[]).filter(Boolean);
    if(!questions.length)return;
    var base=phfAttemptSeed(quizKey);
    var groups={};
    questions.forEach(function(q,i){
      if(q.dataset && q.dataset.phfOptionsShuffled==='1') return;
      phfEnsureStableAnswerIds(q,'data-answer');
      var nodes=phfOptionNodes(q);
      if(nodes.length<2)return;
      if(!groups[nodes.length])groups[nodes.length]=[];
      groups[nodes.length].push({q:q,index:i,nodes:nodes});
    });
    Object.keys(groups).forEach(function(sizeKey){
      var size=Number(sizeKey),items=groups[sizeKey];
      // Danh sách slot đúng cân bằng tuyệt đối: chênh tối đa 1 câu giữa các vị trí.
      var slots=[];
      for(var i=0;i<items.length;i++)slots.push(i%size);
      slots=phfShuffle(slots,base^phfHash(String(quizKey)+':balanced-slots:'+size));
      items.forEach(function(item,groupIndex){
        var q=item.q,nodes=item.nodes;
        var answer=phfCorrectValue(q);
        var correctNode=nodes.find(function(node){
          var input=node.querySelector('input[type="radio"]');
          return input && String(input.value||'').trim().toLowerCase()===answer;
        });
        if(!correctNode){
          console.warn('PHF quiz: không tìm thấy đáp án đúng để trộn',quizKey,phfQuestionKey(q,item.index),answer);
          return;
        }
        var wrongNodes=nodes.filter(function(node){return node!==correctNode;});
        wrongNodes=phfShuffle(wrongNodes,base^phfHash('wrong:'+phfQuestionKey(q,item.index)));
        var target=slots[groupIndex];
        var ordered=wrongNodes.slice();
        ordered.splice(target,0,correctNode);
        phfApplyOptionOrder(nodes,ordered);
        q.dataset.phfOptionsShuffled='1';
        q.dataset.phfCorrectPosition=String(target+1);
        q.dataset.phfQuizKey=String(quizKey||'quiz');
      });
    });
  }
  function phfShuffleQuestionOrder(questions,seed){
    questions=Array.from(questions||[]).filter(Boolean);
    if(questions.length<2||questions.every(function(q){return q.dataset.phfQuestionShuffled==='1'}))return;
    var slots=questions.map(function(q){var c=document.createComment('phf-question-slot');q.replaceWith(c);return c});
    var mixed=phfShuffle(questions,seed);
    slots.forEach(function(slot,i){mixed[i].dataset.phfQuestionShuffled='1';slot.replaceWith(mixed[i])});
  }
  function phfPrepareMainQuizShuffle(root){
    if(!root)return;
    var configs=[
      {selector:'.step2-question[data-correct]',key:'step2-final',buttonId:'gradeStep2Test'},
      {selector:'.b3-mini[data-answer]',key:'step3-final',buttonId:'gradeB3Test'},
      {selector:'.b4-final-question[data-correct]',key:'step4-final',buttonId:'gradeB4Final'}
    ];
    configs.forEach(function(cfg){
      if(!document.getElementById(cfg.buttonId))return;
      var qs=Array.from(root.querySelectorAll(cfg.selector));if(!qs.length)return;
      var base=phfAttemptSeed(cfg.key);
      phfShuffleAnswers(qs,cfg.key);
      phfShuffleQuestionOrder(qs,base^0x51f15e5d);
    });
  }
  function phfNormalizeAnswerValue(value){
    return String(value==null?'':value).trim().toLowerCase();
  }
  function phfEnsureStableAnswerIds(q,attrName){
    if(!q || !q.querySelectorAll) return false;
    var radios=Array.from(q.querySelectorAll('input[type="radio"]'));
    if(!radios.length) return false;
    var qKey=phfQuestionKey(q,0),seen={};
    radios.forEach(function(r,i){
      var raw=phfNormalizeAnswerValue(r.value||String.fromCharCode(97+i));
      if(!raw) raw=String.fromCharCode(97+i);
      r.value=raw;
      r.dataset.phfAnswerId=qKey+'-'+raw;
      seen[raw]=(seen[raw]||0)+1;
    });
    var answer=phfNormalizeAnswerValue(q.getAttribute(attrName)||q.getAttribute('data-correct')||q.getAttribute('data-answer'));
    var correct=radios.find(function(r){return phfNormalizeAnswerValue(r.value)===answer;});
    q.dataset.phfCorrectAnswerId=correct?(correct.dataset.phfAnswerId||''):'';
    q.dataset.phfAnswerConfigValid=String(!!answer&&!!correct&&Object.keys(seen).every(function(k){return seen[k]===1;}));
    return q.dataset.phfAnswerConfigValid==='true';
  }
  function phfIsSelectedAnswerCorrect(q,checked,attrName){
    if(!q || !checked) return false;
    if(!phfEnsureStableAnswerIds(q,attrName)) return false;
    var answer=phfNormalizeAnswerValue(q.getAttribute(attrName)||q.getAttribute('data-correct')||q.getAttribute('data-answer'));
    var selectedValue=phfNormalizeAnswerValue(checked.value);
    if(answer&&selectedValue) return selectedValue===answer;
    var correctId=String(q.dataset.phfCorrectAnswerId||'').trim();
    var selectedId=String(checked.dataset.phfAnswerId||'').trim();
    return !!correctId&&!!selectedId&&selectedId===correctId;
  }
  function phfMarkQuizAnswers(questions,attrName){
    questions=Array.from(questions||[]);var total=questions.length,correct=0,missing=0,wrong=[];
    questions.forEach(function(q){
      q.classList.remove('phf-quiz-correct','phf-quiz-wrong','b3-correct','b3-incorrect','b4-correct','b4-incorrect','correct','wrong');
      phfEnsureStableAnswerIds(q,attrName);
      var checked=q.querySelector('input[type="radio"]:checked');
      if(!checked){missing++;wrong.push(q);q.classList.add('phf-quiz-wrong');return}
      if(phfIsSelectedAnswerCorrect(q,checked,attrName)){
        correct++;q.classList.add('phf-quiz-correct','b3-correct','b4-correct','correct');
      }else{wrong.push(q);q.classList.add('phf-quiz-wrong','b3-incorrect','b4-incorrect','wrong')}
    });
    return{total:total,correct:correct,missing:missing,wrong:wrong,score:total?Math.round(correct/total*100):0};
  }
  function phfRenderQuizResult(el,stat,passScore){
    if(!el)return;var passed=Number(stat.score)>=(passScore||80);el.classList.remove('pass','fail','show');el.classList.add(passed?'pass':'fail','show');
    el.innerHTML='<b>'+(passed?'Đạt':'Chưa đạt')+' · '+stat.score+'/100 điểm</b><br>Đúng '+stat.correct+'/'+stat.total+' câu.'+(stat.missing?' · Còn '+stat.missing+' câu chưa chọn.':'')+(passed?'<br>Bạn có thể tiếp tục phần tiếp theo.':'<br>Vui lòng xem lại các câu chưa đúng/chưa chọn rồi chấm lại.');
  }
  function phfStoreQuizResult(key,stat){try{var storageKey=(typeof window.phfLearningStorageKey==='function'?window.phfLearningStorageKey('phfQuizResults'):'phfQuizResults:'+String((profile().employeeId||profile().id||profile().email||'anonymous')));var list=JSON.parse(localStorage.getItem(storageKey)||'[]');list.push({key:key,lessonIndex:currentIndex(),score:stat.score,correct:stat.correct,total:stat.total,savedAt:new Date().toISOString()});localStorage.setItem(storageKey,JSON.stringify(list.slice(-80)))}catch(e){}}
  function quizCompletionState(key){
    try{
      if(typeof window.phfGetQuizCompletionState==='function') return window.phfGetQuizCompletionState(key)||{};
    }catch(e){}
    return {passed:false,bestScore:null,latestScore:null,savedAt:''};
  }
  function clearQuestionState(q){
    q.classList.remove('phf-quiz-correct','phf-quiz-wrong','b3-correct','b3-incorrect','b4-correct','b4-incorrect','correct','wrong','phf-short-locked','phf-short-wrong');
    q.querySelectorAll('input[type="radio"]').forEach(function(r){r.checked=false;r.disabled=false;});
  }
  function completedCard(root,key,state,questions,controls){
    if(!root || !state || !state.passed) return null;
    var id='phf-quiz-completed-'+String(key).replace(/[^a-z0-9_-]/gi,'_');
    var old=document.getElementById(id); if(old) old.remove();
    var card=document.createElement('section');
    card.id=id; card.className='phf-quiz-completed-card';
    var when=state.savedAt?new Date(state.savedAt).toLocaleString('vi-VN'):'';
    var isShort=String(key||'').indexOf('short-')===0;
    var best=Number(state.bestScore||100);
    var latest=Number.isFinite(Number(state.latestScore))?Number(state.latestScore):best;
    var title=isShort?'Đã hoàn thành bài kiểm tra ngắn':'Đã hoàn thành bài kiểm tra';
    var scoreLine=isShort
      ? ('Điểm đạt: '+best+'/100')
      : ('Điểm cao nhất: '+best+'/100 · Điểm lần gần nhất: '+latest+'/100');
    card.innerHTML='<div class="phf-quiz-completed-icon">✓</div><div class="phf-quiz-completed-copy"><strong>'+title+'</strong><span>'+scoreLine+(when?' · Hoàn thành: '+when:'')+'</span><small>Trạng thái: Đạt · Kết quả đã được máy chủ ghi nhận. Làm lại để ôn tập không làm mất kết quả đã đạt.</small></div><div class="phf-quiz-completed-actions"><button type="button" class="btn btn-soft phf-view-quiz">Xem lại nội dung</button><button type="button" class="btn btn-primary phf-retry-quiz">Làm lại để ôn tập</button></div>';
    var first=questions&&questions[0];
    if(first&&first.parentNode) first.parentNode.insertBefore(card,first);
    (questions||[]).forEach(function(q){q.hidden=true;q.querySelectorAll('input').forEach(function(x){x.disabled=true;});});
    (controls||[]).filter(Boolean).forEach(function(x){x.hidden=true;});
    var view=card.querySelector('.phf-view-quiz');
    var retry=card.querySelector('.phf-retry-quiz');
    view.addEventListener('click',function(){
      var show=(questions||[]).some(function(q){return q.hidden;});
      (questions||[]).forEach(function(q){q.hidden=!show;q.querySelectorAll('input').forEach(function(x){x.disabled=true;});});
      view.textContent=show?'Ẩn nội dung':'Xem lại nội dung';
    });
    retry.addEventListener('click',function(){
      (questions||[]).forEach(function(q){q.hidden=false;clearQuestionState(q);});
      (controls||[]).filter(Boolean).forEach(function(x){x.hidden=false;});
      card.hidden=true;
    });
    return card;
  }
  async function submitQuiz(key,stat,kind){
    if(typeof window.phfSubmitQuizAttempt!=='function') throw new Error('Quiz submit service chưa sẵn sàng');
    return window.phfSubmitQuizAttempt(key,stat,{kind:kind||'main',lessonIndex:currentIndex()});
  }
  function gradeMain(selector,resultId,attr,key,btn,nextId){
    var root=document.getElementById('mainLesson');if(!root)return;
    var qs=Array.from(root.querySelectorAll(selector)),out=document.getElementById(resultId);
    if(!qs.length){notice('warning','Chưa tìm thấy câu hỏi','Chưa nhận được danh sách câu hỏi để chấm.');return}
    setButtonLoading(btn,true,'Đang chấm và lưu...');
    setTimeout(async function(){
      try{
        var stat=phfMarkQuizAnswers(qs,attr);
        if(stat.missing){
          phfRenderQuizResult(out,stat,80);
          notice('warning','Chưa trả lời đủ','Vui lòng trả lời đầy đủ tất cả câu hỏi trước khi nộp bài.');
          return;
        }
        var saved=await submitQuiz(key,stat,'main');
        phfRenderQuizResult(out,stat,80);
        if(stat.score>=80){
          if(nextId){var n=document.getElementById(nextId);if(n)n.style.display='inline-flex'}
          completedCard(root,key,saved||quizCompletionState(key),qs,[btn,out]);
          notice('success','Đã ghi nhận kết quả','Bài kiểm tra đã được lưu thành công và phần tiếp theo đã được mở.');
        }else{
          notice('warning','Chưa đạt bài kiểm tra','Kết quả đã được ghi nhận. Vui lòng xem lại và đạt từ 80/100 trước khi tiếp tục.');
        }
      }catch(err){
        console.error('PHF quiz grading error',err);
        notice('error','Chưa lưu được kết quả',err&&err.message?err.message:'Hệ thống chưa lưu được kết quả. Bài tiếp theo chưa được mở.');
      }finally{
        setButtonLoading(btn,false);
      }
    },80);
  }
  function convertGiftQuick(root){
    root.querySelectorAll('.b4-quiz').forEach(function(q,qi){
      if(q.querySelector('input[type="radio"]'))return;var ans=q.querySelector('.b4-answer');if(!ans)return;var m=(ans.textContent||'').match(/Đáp án đúng\s*:\s*([A-D])/i);if(!m)return;
      q.setAttribute('data-answer',m[1].toLowerCase());var p=q.querySelector('p');if(!p)return;ans.remove();var html=p.innerHTML.split(/<br\s*\/?\s*>/i);p.remove();
      html.forEach(function(line){var div=document.createElement('div');div.innerHTML=line;var txt=(div.textContent||'').trim();var mm=txt.match(/^([A-D])\.\s*(.*)$/i);if(!mm)return;var lab=document.createElement('label');lab.className='answer-choice';lab.innerHTML='<input type="radio" name="giftq'+qi+'" value="'+mm[1].toLowerCase()+'"> '+mm[2];q.appendChild(lab)});
      q.classList.add('phf-quiz-question');
    });
  }
  function injectShortCss(){if(document.getElementById('phf-required-short-quiz-css'))return;var s=document.createElement('style');s.id='phf-required-short-quiz-css';s.textContent='.phf-quiz-completed-card{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:14px;align-items:center;margin:14px 0 18px;padding:16px;border:1px solid #cce5d6;border-radius:16px;background:#f2faf5}.phf-quiz-completed-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#16734b;color:#fff;font-size:24px;font-weight:800}.phf-quiz-completed-copy{display:grid;gap:4px;color:#24483b}.phf-quiz-completed-copy strong{font-size:16px}.phf-quiz-completed-copy span{font-size:14px;font-weight:700}.phf-quiz-completed-copy small{font-size:12px;color:#60786f}.phf-quiz-completed-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}@media(max-width:760px){.phf-quiz-completed-card{grid-template-columns:44px 1fr}.phf-quiz-completed-actions{grid-column:1/-1;justify-content:flex-start}}.phf-short-identity{display:grid;grid-template-columns:1fr 220px;gap:12px;margin:14px 0;padding:14px;border:1px solid #d7e7df;border-radius:14px;background:#f8fbf9}.phf-short-identity label{display:grid;gap:6px;color:#38594d;font-size:13px;font-weight:700}.phf-short-identity input{min-height:42px;border:1px solid #cfe1d8;border-radius:10px;padding:0 11px;background:#fff;color:#17382d}.phf-short-identity-auto input[readonly]{background:#f1f6f3;color:#315448;cursor:default}.phf-short-identity-auto:after{content:"Thông tin được hệ thống tự nhận diện từ hồ sơ học viên.";grid-column:1/-1;font-size:12px;color:#617b71}.phf-short-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0 4px}.phf-short-result{padding:12px 14px;border-radius:12px;background:#fff7e7;border:1px solid #efd59b;color:#704b00}.phf-short-result.pass{background:#eef8f2;border-color:#cde8d7;color:#17603f}.phf-short-locked input{pointer-events:none}.phf-short-locked{opacity:.82}.phf-short-wrong input:checked{outline:2px solid #bd3a3a}@media(max-width:680px){.phf-short-identity{grid-template-columns:1fr}}';document.head.appendChild(s)}

  function prepareStageReview(root,idx){
    if(Number(idx)!==22)return;
    var answerByName={nq1:'a',nq2:'b',nq3:'a',nq4:'a',nq5:'a',nq6:'a',tp1:'a',tp2:'a',tp3:'a',tp4:'a',tp5:'a',tp6:'a',vh1:'a',vh2:'a',vh3:'a',vh4:'a',vh5:'a',vh6:'a',vh7:'a'};
    root.querySelectorAll('.test-section .question-block').forEach(function(block){
      var radios=Array.from(block.querySelectorAll('input[type="radio"]'));
      if(!radios.length)return;
      var name=String(radios[0].name||'').trim();
      var answer=phfNormalizeAnswerValue(block.getAttribute('data-answer')||answerByName[name]);
      if(!answer)return;
      block.classList.add('phf-quiz-question');
      block.setAttribute('data-answer',answer);
      radios.forEach(function(r,i){
        var value=phfNormalizeAnswerValue(r.value||String.fromCharCode(97+i));
        r.value=value||String.fromCharCode(97+i);
        r.dataset.phfAnswerId=name+'-'+r.value;
      });
      block.dataset.phfAnswerNormalized='1';
      if(!block.dataset.questionId) block.dataset.questionId='gd1-review-'+name;
      phfEnsureStableAnswerIds(block,'data-answer');
    });
  }
  function stageReviewIdentity(root,idx){
    if(Number(idx)!==22)return null;
    var box=root.querySelector('.signature-xem,.signature-preview,.commit-signature');
    if(!box)return null;
    var name=box.querySelector('input[type="text"],input:not([type]),input[type="search"]');
    var date=box.querySelector('input[type="date"]');
    if(name){name.classList.add('phf-short-name');name.required=true;name.placeholder='Tự động lấy từ hồ sơ'}
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
  function inferShortQuiz(root,idx){
    var key=SHORT_TESTS[idx]||null;
    if(root&&root.querySelector('input[name="nq1"]')) return {idx:22,key:'short-gd1-review'};
    return key?{idx:idx,key:key}:null;
  }
  function setupShortQuiz(){
    var root=document.getElementById('mainLesson');if(!root)return;
    var inferred=inferShortQuiz(root,currentIndex());if(!inferred)return;
    var idx=inferred.idx,key=inferred.key;
    injectShortCss();if(idx===86)convertGiftQuick(root);prepareStageReview(root,idx);var qs=questionsFor(root);if(!qs.length)return;phfShuffleAnswers(qs,key);
    try{
      var dist=phfQuizDistribution(root),counts=Object.keys(dist).map(function(k){return Number(dist[k])||0;});
      if(counts.length){
        var max=Math.max.apply(null,counts),min=Math.min.apply(null,counts);
        if(max-min>1){
          qs.forEach(function(q){delete q.dataset.phfOptionsShuffled;delete q.dataset.phfCorrectPosition;});
          phfShuffleAnswers(qs,key+':retry');
          dist=phfQuizDistribution(root);counts=Object.keys(dist).map(function(k){return Number(dist[k])||0;});
          max=Math.max.apply(null,counts);min=Math.min.apply(null,counts);
          if(max-min>1) console.error('PHF quiz distribution lỗi sau fallback',key,dist);
        }
      }
    }catch(e){console.error('PHF quiz distribution check error',e)}
    root.querySelectorAll('.test-note').forEach(function(n){n.innerHTML='<b>Yêu cầu:</b> Trả lời đủ và sửa đúng toàn bộ câu chưa đúng trước khi chuyển sang bài tiếp theo.'});
    var blue=root.querySelector('.bluebox p');if(blue)blue.textContent='Phần kiểm tra ngắn bắt buộc. Bạn cần trả lời đủ, sửa đúng toàn bộ câu chưa đúng và hoàn tất xác nhận trước khi chuyển sang bài tiếp theo.';
    var oldAction=root.querySelector('.phf-quiz-actions');if(oldAction)oldAction.remove();
    var first=qs[0],form=stageReviewIdentity(root,idx)||root.querySelector('.phf-short-identity');if(!form){
      form=document.createElement('div');form.className='phf-short-identity';form.innerHTML='<label>Người thực hiện <span><input class="phf-short-name" type="text" required readonly placeholder="Tự động lấy từ hồ sơ"></span></label><label>Ngày thực hiện <span><input class="phf-short-date" type="date" required readonly></span></label>';first.parentNode.insertBefore(form,first);
    }
    applyAutoIdentity(form);
    var actions=root.querySelector('.phf-short-actions');if(!actions){actions=document.createElement('div');actions.className='phf-short-actions';actions.innerHTML='<button class="btn btn-primary phf-grade-short" type="button">Chấm bài kiểm tra ngắn</button><div class="phf-short-result" hidden></div>';var anchor=Number(idx)===22?(root.querySelector('.commit-final')||qs[qs.length-1]):qs[qs.length-1];anchor.insertAdjacentElement('afterend',actions)}
    var btn=actions.querySelector('.phf-grade-short'),out=actions.querySelector('.phf-short-result');
    var existingState=quizCompletionState(key);
    if(existingState && existingState.passed){
      completedCard(root,key,existingState,qs,[form,actions]);
    }
    if(btn.dataset.phfBound==='1')return;btn.dataset.phfBound='1';
    btn.addEventListener('click',async function(){
      if(btn.dataset.phfGrading==='1')return;
      var identity=applyAutoIdentity(form),name=identity.fullName,date=identity.date;
      if(!name){notice('error','Chưa liên kết hồ sơ học viên','Tài khoản chưa có họ tên từ hồ sơ nhân viên. Vui lòng liên hệ Quản trị viên để kiểm tra liên kết tài khoản trước khi làm bài.');return}
      if(!validateStageReviewChecks(root,idx))return;
      btn.dataset.phfGrading='1';
      setButtonLoading(btn,true,'Đang chấm...');
      var completed=false,nextText='Chấm lại';
      try{
          var invalid=qs.filter(function(q){return !phfEnsureStableAnswerIds(q,'data-answer');});
          if(invalid.length) throw new Error('Cấu hình đáp án không hợp lệ ở '+invalid.length+' câu');
          var stat=phfMarkQuizAnswers(qs,'data-answer');
          qs.forEach(function(q){
            var checked=q.querySelector('input[type="radio"]:checked');
            var ok=!!checked&&phfIsSelectedAnswerCorrect(q,checked,'data-answer');
            q.classList.toggle('phf-short-locked',ok);
            q.classList.toggle('phf-short-wrong',!ok);
            q.querySelectorAll('input[type="radio"]').forEach(function(r){r.disabled=ok});
          });
          out.hidden=false;out.classList.toggle('pass',stat.correct===stat.total&&stat.total>0);
          if(stat.missing){out.innerHTML='<b>Còn '+stat.missing+' câu chưa chọn.</b><br>Các lựa chọn hiện tại vẫn được giữ nguyên. Vui lòng chọn đủ rồi chấm lại.';nextText='Chấm lại bài kiểm tra ngắn'}
          else if(stat.correct<stat.total){out.innerHTML='<b>Còn '+(stat.total-stat.correct)+' câu chưa đúng.</b><br>Hệ thống giữ nguyên toàn bộ lựa chọn để bạn đối chiếu và chọn lại câu chưa đúng.';nextText='Kiểm tra lại các câu chưa đúng'}
          else{
            nextText='Đang lưu kết quả...';
            out.innerHTML='<b>Đã trả lời đúng toàn bộ câu hỏi.</b><br>Hệ thống đang lưu kết quả và cập nhật tiến độ...';
            var saved=await submitQuiz(key,{score:100,correct:stat.total,total:stat.total},'short');
            completed=true;nextText='Đã hoàn thành';
            out.innerHTML='<b>Hoàn thành · 100/100 điểm.</b><br>Kết quả đã được lưu thành công. Bạn có thể chuyển sang bài tiếp theo.';
            form.querySelectorAll('input').forEach(function(x){x.disabled=true});
            completedCard(root,key,saved||quizCompletionState(key),qs,[form,actions]);
            notice('success','Đã ghi nhận kết quả','Bài kiểm tra ngắn đã được lưu thành công và bài tiếp theo đã được mở.');
          }
        }catch(err){
          console.error('PHF short quiz grading error',err);
          try{ if(typeof window.phfClearLocalQuizPass==='function') window.phfClearLocalQuizPass(key); }catch(_e){}
          notice('error','Chưa thể chấm bài','Hệ thống chưa xử lý được kết quả. Vui lòng thử lại, dữ liệu chưa được ghi nhận là hoàn thành.');
          nextText='Chấm lại bài kiểm tra ngắn';
      }finally{
        delete btn.dataset.phfGrading;
        setButtonLoading(btn,false);
        btn.textContent=nextText;
        btn.disabled=completed;
      }
    });
  }
  function phfBindLessonQuizScoring(){
    var root=document.getElementById('mainLesson');phfPrepareMainQuizShuffle(root);
    var s2=document.getElementById('gradeStep2Test');if(s2){var q2=Array.from(root.querySelectorAll('.step2-question[data-correct]'));completedCard(root,'step2-final',quizCompletionState('step2-final'),q2,[s2,document.getElementById('step2TestResult')]);if(s2.dataset.phfBound!=='1'){s2.dataset.phfBound='1';s2.addEventListener('click',function(){gradeMain('.step2-question[data-correct]','step2TestResult','data-correct','step2-final',s2)})}}
    var b3=document.getElementById('gradeB3Test');if(b3){var q3=Array.from(root.querySelectorAll('.b3-mini[data-answer]'));completedCard(root,'step3-final',quizCompletionState('step3-final'),q3,[b3,document.getElementById('b3Result')]);if(b3.dataset.phfBound!=='1'){b3.dataset.phfBound='1';b3.addEventListener('click',function(){gradeMain('.b3-mini[data-answer]','b3Result','data-answer','step3-final',b3,'goB3Complete')})}}
    var b4=document.getElementById('gradeB4Final');if(b4){var q4=Array.from(root.querySelectorAll('.b4-final-question[data-correct]'));completedCard(root,'step4-final',quizCompletionState('step4-final'),q4,[b4,document.getElementById('b4FinalResult')]);if(b4.dataset.phfBound!=='1'){b4.dataset.phfBound='1';b4.addEventListener('click',function(){gradeMain('.b4-final-question[data-correct]','b4FinalResult','data-correct','step4-final',b4,'goB4Complete')})}}
    setupShortQuiz();
  }
  function phfQuizDistribution(root){
    root=root||document.getElementById('mainLesson');if(!root)return{};
    var out={};questionsFor(root).forEach(function(q){
      var answer=phfCorrectValue(q),radios=Array.from(q.querySelectorAll('input[type="radio"]'));
      var pos=radios.findIndex(function(r){return String(r.value||'').toLowerCase()===answer;});
      if(pos>=0) out[pos+1]=(out[pos+1]||0)+1;
    });
    return out;
  }
  window.phfQuizDistribution=phfQuizDistribution;
  function phfEnsureCurrentQuizPrepared(){
    try{ phfBindLessonQuizScoring(); }catch(e){ console.warn('PHF quiz prepare error',e); }
  }
  window.phfPrepareQuizNow=phfEnsureCurrentQuizPrepared;
  function phfObserveLessonRoot(){
    var root=document.getElementById('mainLesson');
    if(!root||root.dataset.phfQuizObserved==='1'||typeof MutationObserver!=='function') return;
    root.dataset.phfQuizObserved='1';
    var pending=0;
    new MutationObserver(function(){
      clearTimeout(pending);
      pending=setTimeout(phfEnsureCurrentQuizPrepared,0);
    }).observe(root,{childList:true,subtree:false});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){phfObserveLessonRoot();setTimeout(phfEnsureCurrentQuizPrepared,0);});
  else {phfObserveLessonRoot();setTimeout(phfEnsureCurrentQuizPrepared,0);}
  window.addEventListener('phf-auth-changed',function(){setTimeout(phfEnsureCurrentQuizPrepared,120);});
  document.addEventListener('click',function(e){
    if(e.target&&e.target.closest&&e.target.closest('[onclick^="go("],.todo-item,.phase')) setTimeout(phfEnsureCurrentQuizPrepared,80);
  });
  window.phfMarkQuizAnswers=phfMarkQuizAnswers;window.phfRenderQuizResult=phfRenderQuizResult;window.phfStoreQuizResult=phfStoreQuizResult;window.phfBindLessonQuizScoring=phfBindLessonQuizScoring;window.PHF_checkDay1AfternoonQuiz=function(){var b=document.querySelector('.phf-grade-short');if(b)b.click()};
})();
