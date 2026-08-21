'use strict';

const SCORE_FORMULA_VERSION='excel_weighted_average_1_2_v2';

function number(value){const parsed=Number(String(value==null?'':value).replace('%','').replace(',','.').trim());return Number.isFinite(parsed)?parsed:NaN;}
function round2(value){return Math.round((Number(value)||0)*100)/100;}
function engineError(message,code){const error=new Error(message);error.code=code;error.statusCode=409;throw error;}
function normalizeCriterion(actual,target){
  const targetValue=number(target),actualValue=number(actual);
  if(!Number.isFinite(targetValue)||targetValue<=0)engineError('Target must be a number greater than 0.','CHECKLIST_SCORE_TARGET_INVALID');
  if(!Number.isFinite(actualValue)||actualValue<0)engineError('Actual must be a number greater than or equal to 0.','CHECKLIST_SCORE_ACTUAL_INVALID');
  return Math.min(10,(actualValue/targetValue)*10);
}
function calculateSide(criteria,actualByCode){
  let weightedSum=0,totalWeight=0;
  const normalized={};
  criteria.forEach((criterion,index)=>{
    const code=String(criterion&&criterion.code||('ROW-'+(index+1))),weight=number(criterion&&criterion.weight),target=number(criterion&&criterion.target);
    if(!Number.isFinite(target)||target<=0)engineError('Target '+code+' must be a number greater than 0.','CHECKLIST_SCORE_TARGET_INVALID');
    if(!Number.isFinite(weight)||weight<=0)engineError('Weight '+code+' must be greater than 0.','CHECKLIST_SCORE_WEIGHT_INVALID');
    const raw=actualByCode&&Object.prototype.hasOwnProperty.call(actualByCode,code)?actualByCode[code]:0;
    const score=normalizeCriterion(raw==null||raw===''?0:raw,target);
    normalized[code]=score;weightedSum+=score*weight;totalWeight+=weight;
  });
  if(totalWeight<=0)engineError('Total applicable weight must be greater than 0.','CHECKLIST_SCORE_TOTAL_WEIGHT_INVALID');
  return {total10:Math.min(10,weightedSum/totalWeight),weightedSum,totalWeight,normalized};
}
function calculateMonthlyScore({criteria,selfActualByCode,reviewActualByCode}){
  const rows=Array.isArray(criteria)?criteria:[];
  if(!rows.length)engineError('At least one applicable criterion is required.','CHECKLIST_SCORE_CRITERIA_REQUIRED');
  const self=calculateSide(rows,selfActualByCode||{}),review=calculateSide(rows,reviewActualByCode||{});
  const final10=(self.total10+review.total10*2)/3;
  return {
    formulaVersion:SCORE_FORMULA_VERSION,
    selfTotal10:self.total10,reviewTotal10:review.total10,final10,
    selfTotalScore:round2(self.total10*10),reviewTotalScore:round2(review.total10*10),finalScore:round2(final10*10),
    selfWeightedSum:self.weightedSum,reviewWeightedSum:review.weightedSum,totalWeight:self.totalWeight,
    selfNormalized:self.normalized,reviewNormalized:review.normalized
  };
}

module.exports={SCORE_FORMULA_VERSION,normalizeCriterion,calculateMonthlyScore,round2};
