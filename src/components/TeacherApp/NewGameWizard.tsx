import React, { useState, useEffect, useRef } from 'react';
import { useGame } from '../../context/GameContext';
import { Question, Student } from '../../types/game';
import { analyzeQuestionQuality, isQuestionReadyForGame } from '../../game/rules';
import { AiAnalysisSummary } from '../../server/ai/aiSchemas';
import { AIReviewWorkspace } from './AIReviewWorkspace';
import {
  Upload,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  QrCode,
  Copy,
  ExternalLink,
  Edit2,
  Check,
  Play,
  FileText,
  FileUp,
  CheckCircle
} from 'lucide-react';
import QRCode from 'qrcode';

export const NewGameWizard: React.FC = () => {
  const {
    state,
    language,
    updateWizardStep,
    generateTeams,
    finishWizard,
    startCompetition,
    quitToStartMenu,
    renameTeam,
  } = useGame();

  const isAr = language === 'ar';
  const currentStep = state?.wizard?.step || 1;

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>(state?.wizard?.selectedLeaderIds || []);
  const [isGeneratingTeams, setIsGeneratingTeams] = useState<boolean>(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState<string>('');

  // Question Bank Upload State (NO TEMPLATES!)
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [rawText, setRawText] = useState<string>('');
  const [uploadedQuestions, setUploadedQuestions] = useState<Question[]>(
    state?.wizard?.uploadedQuestions || []
  );
  const [isParsingQuestions, setIsParsingQuestions] = useState<boolean>(false);
  const [uploadProgressLabel, setUploadProgressLabel] = useState<string>('');
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractionMethodLabel, setExtractionMethodLabel] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<AiAnalysisSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Settings State
  const [roundsCount, setRoundsCount] = useState<number>(50);
  const [groupTimer, setGroupTimer] = useState<number>(45);
  const [cardWindow, setCardWindow] = useState<number>(20);
  const [reactionWindow, setReactionWindow] = useState<number>(15);
  const [streakPercent, setStreakPercent] = useState<number>(10);
  const [questionBonusPoints, setQuestionBonusPoints] = useState<number>(50);
  const [questionMinusPoints, setQuestionMinusPoints] = useState<number>(50);
  const [questionBonusChance, setQuestionBonusChance] = useState<number>(15);
  const [questionMinusChance, setQuestionMinusChance] = useState<number>(10);
  const [comebackBonusPoints, setComebackBonusPoints] = useState<number>(250);

  // Rule Settings Toggles
  const [defensiveCardLimit, setDefensiveCardLimit] = useState<'free_defense' | 'counts_against_round_limit'>('free_defense');
  const [playerLockMode, setPlayerLockMode] = useState<'two_players' | 'two_uses_any'>('two_players');
  const [cardInspectionMode, setCardInspectionMode] = useState<'reveal_all' | 'reveal_one_random'>('reveal_all');
  const [playerSwapMode, setPlayerSwapMode] = useState<'direct_transfer' | 'must_compensate'>('must_compensate');
  const [cardWindowScope, setCardWindowScope] = useState<'private_rounds_only' | 'all_rounds'>('all_rounds');

  // QR Code data URL
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/students')
      .then(r => r.json())
      .then(data => setStudents(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (
      state?.wizard?.selectedLeaderIds &&
      state.wizard.selectedLeaderIds.length > 0 &&
      selectedLeaderIds.length === 0
    ) {
      setSelectedLeaderIds(state.wizard.selectedLeaderIds);
    }
    if (
      state?.wizard?.uploadedQuestions &&
      state.wizard.uploadedQuestions.length > 0 &&
      uploadedQuestions.length === 0
    ) {
      setUploadedQuestions(state.wizard.uploadedQuestions);
    }
  }, [state?.wizard]);

  useEffect(() => {
    if (state?.gameId && currentStep === 6) {
      const joinUrl = `${window.location.origin}/play?gameId=${state.gameId}`;
      QRCode.toDataURL(joinUrl, { width: 280, margin: 2, color: { dark: '#020617', light: '#ffffff' } })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error('Failed to generate QR Code:', err));
    }
  }, [state?.gameId, currentStep]);

  const toggleLeader = (studentId: string) => {
    if (selectedLeaderIds.includes(studentId)) {
      setSelectedLeaderIds(selectedLeaderIds.filter(id => id !== studentId));
    } else if (selectedLeaderIds.length < 4) {
      setSelectedLeaderIds([...selectedLeaderIds, studentId]);
    }
  };

  const handleGenerateTeams = async () => {
    setIsGeneratingTeams(true);
    await generateTeams(selectedLeaderIds);
    await updateWizardStep(2, { leaderIds: selectedLeaderIds });
    setIsGeneratingTeams(false);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const commaIdx = res.indexOf(',');
        resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
      };
      reader.onerror = () => reject(new Error('Failed to read selected file'));
      reader.readAsDataURL(file);
    });

  const handleFileUpload = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.docx') && !lower.endsWith('.txt')) {
      setQuestionError(
        isAr
          ? 'صيغة الملف غير مدعومة. يرجى رفع ملف PDF أو Word (.docx) أو ملف نصي (.txt).'
          : 'Unsupported file format. Please upload a .pdf, .docx, or .txt file.'
      );
      return;
    }

    setIsParsingQuestions(true);
    setQuestionError(null);
    setExtractionWarnings([]);
    setUploadProgressLabel(
      lower.endsWith('.pdf')
        ? `Reading & extracting PDF "${file.name}"...`
        : lower.endsWith('.docx')
        ? `Extracting Word document "${file.name}"...`
        : `Parsing "${file.name}"...`
    );

    try {
      const base64Data = await fileToBase64(file);
      const res = await fetch('/api/questions/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          base64Data,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuestionError(data.error || 'Failed to extract questions from document.');
        return;
      }

      if (!data.questions || data.questions.length === 0) {
        setQuestionError(
          isAr
            ? 'لم يتم العثور على أسئلة واضحة داخل المستند المرفوع.'
            : 'No recognizable questions were extracted from this document.'
        );
        return;
      }

      setUploadedQuestions(prev => [...prev, ...data.questions]);
      setExtractionWarnings(data.warnings || []);
      setAiSummary(data.summary || null);
      setExtractionMethodLabel(
        `${data.method === 'pdf_vision_ocr' ? 'PDF Vision OCR' : data.method === 'pdf_text' ? 'PDF Text Parser' : data.method === 'docx' ? 'Word DOCX Parser' : 'Plain Text'}${
          data.pagesProcessed ? ` (${data.pagesProcessed} pages)` : ''
        }`
      );
    } catch (err: any) {
      setQuestionError(err.message || 'Upload error');
    } finally {
      setIsParsingQuestions(false);
      setUploadProgressLabel('');
    }
  };

  const handleParseQuestions = async (textToParse: string) => {
    if (!textToParse.trim()) return;
    setIsParsingQuestions(true);
    setQuestionError(null);
    setExtractionWarnings([]);
    setUploadProgressLabel('Analyzing & verifying pasted questions with CodeArena AI...');

    try {
      const res = await fetch('/api/ai/parse-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: textToParse }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuestionError(data.error || 'Parsing failed');
        return;
      }
      if (data.questions && data.questions.length > 0) {
        setUploadedQuestions(prev => [...prev, ...data.questions]);
        setExtractionWarnings(data.warnings || []);
        setAiSummary(data.summary || null);
        setExtractionMethodLabel('Pasted Document Text');
      } else {
        setQuestionError(
          isAr
            ? 'لم يتم العثور على أسئلة واضحة في النص.'
            : 'No clear questions found in text. Format with Q1:, Question 1:, or numbered items.'
        );
      }
    } catch (err: any) {
      setQuestionError(err.message);
    } finally {
      setIsParsingQuestions(false);
      setUploadProgressLabel('');
    }
  };

  const updateQuestionItem = (id: string, updates: Partial<Question>) => {
    setUploadedQuestions(prev => {
      const mapped = prev.map(q => {
        if (q.id !== id) return q;
        const next = { ...q, ...updates };
        if (updates.correctAnswer !== undefined) {
          const validAns =
            updates.correctAnswer.trim().length > 0 &&
            updates.correctAnswer.trim().toUpperCase() !== 'NOT PROVIDED';
          next.answerStatus = validAns ? 'provided' : 'not_provided';
          if (!validAns) next.approved = false;
        }
        return next;
      });
      return analyzeQuestionQuality(mapped).questionsWithIssues;
    });
  };

  const replaceQuestionItem = (updated: Question) => {
    setUploadedQuestions(prev =>
      analyzeQuestionQuality(prev.map(q => (q.id === updated.id ? updated : q))).questionsWithIssues
    );
  };

  const deleteQuestionItem = (id: string) => {
    setUploadedQuestions(prev => prev.filter(q => q.id !== id));
  };

  const approvedReadyQuestions = uploadedQuestions.filter(isQuestionReadyForGame);

  const handleFinalizeGame = async () => {
    const clampedRounds = Math.max(1, Math.min(70, Math.round(roundsCount || 50)));
    const settings = {
      totalRounds: clampedRounds,
      groupSpeedTimerSeconds: groupTimer,
      cardWindowSeconds: cardWindow,
      reactionWindowSeconds: reactionWindow,
      streakBonusPercent: streakPercent,
      questionBonusPoints: Math.max(0, questionBonusPoints),
      questionMinusPoints: Math.max(0, questionMinusPoints),
      questionBonusChancePercent: Math.max(0, Math.min(100, questionBonusChance)),
      questionMinusChancePercent: Math.max(0, Math.min(100, questionMinusChance)),
      comebackBonusPoints: Math.max(50, Math.round(comebackBonusPoints || 250)),
      defensiveCardLimitMode: defensiveCardLimit,
      playerLockMode,
      cardInspectionMode,
      playerSwapMode: 'must_compensate',
      cardWindowScope,
    };
    await finishWizard(clampedRounds, settings, approvedReadyQuestions);
  };

  const stepsHeader = [
    { num: 1, labelAr: 'اختيار القادة', labelEn: 'Select Leaders' },
    { num: 2, labelAr: 'توزيع الفرق', labelEn: 'Team Formation' },
    { num: 3, labelAr: 'بنك الأسئلة', labelEn: 'Question Bank' },
    { num: 4, labelAr: 'مراجعة الفرق', labelEn: 'Final Review' },
    { num: 5, labelAr: 'إعدادات اللعبة', labelEn: 'Settings' },
    { num: 6, labelAr: 'جاهزية المباراة', labelEn: 'Ready / Lobby' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-between">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        {/* Wizard Progress Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={quitToStartMenu}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Return to Start Menu"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <div>
              <span className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-widest block">
                CodeArena Setup Wizard
              </span>
              <h2 className="text-lg font-black text-white whitespace-nowrap">
                {isAr ? 'معالج إنشاء مباراة جديدة' : 'New Game Setup Flow'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full xl:w-auto pb-1 xl:pb-0">
            {stepsHeader.map(s => {
              const isActive = currentStep === s.num;
              const isPast = currentStep > s.num;

              return (
                <div
                  key={s.num}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all shrink-0 whitespace-nowrap ${
                    isActive
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                      : isPast
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-slate-950 text-slate-500 border border-slate-800'
                  }`}
                >
                  <span className="font-mono text-[11px]">{s.num}</span>
                  <span className="hidden sm:inline">{isAr ? s.labelAr : s.labelEn}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* STEP 1: Select Team Leaders */}
        {currentStep === 1 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-mono font-bold text-indigo-400">STEP 1 OF 5</span>
              <h3 className="text-2xl font-black text-white">
                {isAr ? 'اختيار قادة الفرق الأربعة' : 'Select Four Team Leaders'}
              </h3>
              <p className="text-xs text-slate-400">
                {isAr
                  ? 'اختر أربعة قادة مختلفين من قائمة الـ 22 طالباً المسجلين. القائد يظل دائماً في فريقه ولا يمكن نقله.'
                  : 'Choose exactly 4 distinct leaders from the 22 students. Leaders remain in their team and cannot be transferred.'}
              </p>
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <span className="font-bold text-slate-300">
                {isAr ? 'القادة المختارون:' : 'Selected Leaders:'}
              </span>
              <span className={`font-mono font-black ${selectedLeaderIds.length === 4 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {selectedLeaderIds.length} / 4
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-96 overflow-y-auto p-1">
              {students.map(std => {
                const isSelected = selectedLeaderIds.includes(std.id);

                return (
                  <button
                    key={std.id}
                    type="button"
                    onClick={() => toggleLeader(std.id)}
                    className={`p-3.5 rounded-2xl border text-right transition-all flex flex-col justify-between gap-1 text-xs ${
                      isSelected
                        ? 'bg-indigo-950/90 border-indigo-500 text-white shadow-lg ring-2 ring-indigo-500/40'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-slate-500 text-[10px]">#{std.id}</span>
                      {isSelected && (
                        <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded-full">
                          {isAr ? 'قائد' : 'Leader'}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-sm text-slate-100">{std.name}</span>
                    {std.nickname && (
                      <span className="text-[11px] text-cyan-400 font-mono">"{std.nickname}"</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={selectedLeaderIds.length !== 4}
                onClick={handleGenerateTeams}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs shadow-xl shadow-cyan-500/20 flex items-center gap-2 transition-all"
              >
                <span>{isAr ? 'متابعة إلى تكوين الفرق' : 'Continue to Team Formation'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Random Team Formation */}
        {currentStep === 2 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-mono font-bold text-indigo-400">STEP 2 OF 5</span>
                <h3 className="text-2xl font-black text-white">
                  {isAr ? 'تكوين وتوزيع الفرق عشوائيًا' : 'Random Team Formation'}
                </h3>
                <p className="text-xs text-slate-400">
                  {isAr
                    ? 'التوزيع العشوائي ينتج فريقين من 6 وفريقين من 5 طلاب مع تثبيت القادة.'
                    : 'Random distribution yields two 6-member teams and two 5-member teams with leaders locked in.'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleGenerateTeams}
                disabled={isGeneratingTeams}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-cyan-300 shadow-md transition-all"
              >
                <RotateCcw className={`w-4 h-4 ${isGeneratingTeams ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'إعادة التوزيع العشوائي' : 'Re-roll Distribution'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.values(state?.teams || {}).map(team => (
                <div
                  key={team.id}
                  className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3"
                  style={{ borderTop: `4px solid ${team.color}` }}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      {editingTeamId === team.id ? (
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="text"
                            value={editingTeamName}
                            onChange={e => setEditingTeamName(e.target.value)}
                            className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-xs text-white font-bold w-full"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              renameTeam(team.id, editingTeamName);
                              setEditingTeamId(null);
                            }}
                            className="p-1 bg-cyan-600 text-white rounded text-[10px] font-bold"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-black text-sm text-white">{team.name}</h4>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTeamId(team.id);
                              setEditingTeamName(team.name);
                            }}
                            className="text-slate-500 hover:text-slate-300 p-1"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded">
                        {team.members.length} Roster
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 flex items-center gap-1 mb-2">
                      <span className="text-slate-500">Leader:</span>
                      <span className="font-bold text-amber-400">{team.leaderName}</span>
                    </p>

                    <div className="space-y-1 pt-2 border-t border-slate-900 text-xs">
                      {team.members.map(m => (
                        <div key={m.studentId} className="flex items-center justify-between text-slate-300">
                          <span>{m.name}</span>
                          {m.isLeader && (
                            <span className="text-[10px] text-amber-400 font-bold bg-amber-950/60 px-1.5 py-0.2 rounded">
                              Leader
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => updateWizardStep(1)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isAr ? 'الرجوع للقادة' : 'Back to Leaders'}</span>
              </button>

              <button
                type="button"
                onClick={() => updateWizardStep(3)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs shadow-xl shadow-cyan-500/20 flex items-center gap-2"
              >
                <span>{isAr ? 'متابعة إلى بنك الأسئلة' : 'Continue to Question Bank'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Real PDF, DOCX, & Paste Question Bank (ZERO TEMPLATES) */}
        {currentStep === 3 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="space-y-1">
              <span className="text-xs font-mono font-bold text-indigo-400">STEP 3 OF 5</span>
              <h3 className="text-2xl font-black text-white">
                {isAr ? 'رفع بنك الأسئلة (PDF / Word / نص)' : 'Upload Mandatory Question Bank'}
              </h3>
              <p className="text-xs text-slate-400">
                Upload a real PDF (text or scanned), Word (.docx), or paste document text. All English wording and code blocks are preserved verbatim; missing answers are marked <code className="text-amber-300">NOT PROVIDED</code> for teacher completion.
              </p>
            </div>

            {/* Method Selector Tabs */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold max-w-md">
              <button
                type="button"
                onClick={() => setInputMode('file')}
                className={`w-1/2 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  inputMode === 'file' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Upload PDF / Word (.docx)</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('paste')}
                className={`w-1/2 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  inputMode === 'paste' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Raw Text</span>
              </button>
            </div>

            {/* Method A & B: Drag & Drop File Upload */}
            {inputMode === 'file' ? (
              <div
                onDragOver={e => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={e => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className={`rounded-2xl border-2 border-dashed p-8 text-center transition-all space-y-3 ${
                  isDraggingFile
                    ? 'border-cyan-400 bg-cyan-950/30'
                    : 'border-slate-700 bg-slate-950/70 hover:border-slate-500'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-700 mx-auto flex items-center justify-center text-cyan-400">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-black text-white">
                    Drag & Drop PDF or Word (.docx) File Here
                  </p>
                  <p className="text-xs text-slate-400">
                    Supports text-based PDFs, scanned PDFs (OCR), Word .docx documents, and .txt files.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isParsingQuestions}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg"
                >
                  {isParsingQuestions ? 'Processing Document...' : 'Browse Files'}
                </button>
              </div>
            ) : (
              /* Method C: Paste Text */
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <label className="text-xs font-bold text-slate-300 block">
                  Paste Verbatim Questions (English):
                </label>
                <textarea
                  rows={6}
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  placeholder={`Q1: What is the output of print(2 ** 3) in Python?\nA) 6\nB) 8\nC) 9\nD) 16\nAnswer: B`}
                  dir="ltr"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Verbatim wording & code formatting preserved.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleParseQuestions(rawText)}
                    disabled={isParsingQuestions || !rawText.trim()}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isParsingQuestions ? 'Extracting...' : 'Extract Questions'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Processing Progress Indicator */}
            {isParsingQuestions && (
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-cyan-300">
                  <span>{uploadProgressLabel || 'Processing...'}</span>
                  <span>Running</span>
                </div>
                <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-400 w-2/3 animate-pulse rounded-full" />
                </div>
              </div>
            )}

            {questionError && (
              <div className="p-3 rounded-xl bg-rose-950 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{questionError}</span>
              </div>
            )}

            {extractionWarnings.map((w, i) => (
              <div key={i} className="p-3 rounded-xl bg-amber-950/70 border border-amber-700 text-amber-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>{w}</span>
              </div>
            ))}

            {/* CodeArena AI Question Intelligence Review Workspace */}
            <AIReviewWorkspace
              questions={uploadedQuestions}
              summary={aiSummary}
              extractionMethodLabel={extractionMethodLabel}
              onUpdateQuestion={updateQuestionItem}
              onReplaceQuestion={replaceQuestionItem}
              onDeleteQuestion={deleteQuestionItem}
              onClearAll={() => {
                setUploadedQuestions([]);
                setAiSummary(null);
              }}
            />

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => updateWizardStep(2)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isAr ? 'الرجوع للفرق' : 'Back to Teams'}</span>
              </button>

              <button
                type="button"
                disabled={approvedReadyQuestions.length === 0}
                onClick={() => updateWizardStep(4, { uploadedQuestions: approvedReadyQuestions })}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs shadow-xl shadow-cyan-500/20 flex items-center gap-2"
              >
                <span>{isAr ? 'متابعة إلى مراجعة الفرق' : 'Continue to Final Review'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Final Team Review */}
        {currentStep === 4 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-mono font-bold text-indigo-400">STEP 4 OF 5</span>
              <h3 className="text-2xl font-black text-white">
                {isAr ? 'المراجعة النهائية لتشكيلة الفرق' : 'Final Team Review'}
              </h3>
              <p className="text-xs text-slate-400">
                Review the 4 finalized teams and {approvedReadyQuestions.length} approved questions before setting game parameters.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.values(state?.teams || {}).map(team => (
                <div
                  key={team.id}
                  className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2"
                  style={{ borderTop: `4px solid ${team.color}` }}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-base text-white">{team.name}</h4>
                    <span className="text-xs font-mono text-cyan-400">{team.members.length} Roster</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    <span className="text-slate-500">Leader: </span>
                    <span className="font-bold text-amber-400">{team.leaderName}</span>
                  </p>
                  <div className="pt-2 border-t border-slate-900 space-y-1 text-xs text-slate-300">
                    {team.members.map(m => (
                      <div key={m.studentId} className="flex items-center justify-between">
                        <span>{m.name}</span>
                        {m.isLeader && <span className="text-[10px] text-amber-400 font-bold">[Leader]</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => updateWizardStep(3)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isAr ? 'الرجوع للأسئلة' : 'Back to Questions'}</span>
              </button>

              <button
                type="button"
                onClick={() => updateWizardStep(5)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs shadow-xl shadow-cyan-500/20 flex items-center gap-2"
              >
                <span>{isAr ? 'متابعة إلى الإعدادات' : 'Continue to Settings'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Game Settings & Rules */}
        {currentStep === 5 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-mono font-bold text-indigo-400">STEP 5 OF 5</span>
              <h3 className="text-2xl font-black text-white">
                {isAr ? 'إعدادات وقواعد المسابقة' : 'Competition Settings & Rules'}
              </h3>
              <p className="text-xs text-slate-400">
                Configure rounds, timers, and strategic card policies.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="wizard-total-rounds" className="font-bold text-slate-300 block">
                    Total Rounds:
                  </label>
                  <span className="text-[11px] font-mono text-cyan-400">Default 50 • Max 70</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Preset Total Rounds"
                    value={[20, 30, 40, 50, 60, 70].includes(roundsCount) ? roundsCount : 'custom'}
                    onChange={e => {
                      if (e.target.value !== 'custom') {
                        setRoundsCount(Number(e.target.value));
                      }
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                  >
                    <option value={20}>20 Rounds</option>
                    <option value={30}>30 Rounds</option>
                    <option value={40}>40 Rounds</option>
                    <option value={50}>50 Rounds (Default)</option>
                    <option value={60}>60 Rounds</option>
                    <option value={70}>70 Rounds (Max)</option>
                    {![20, 30, 40, 50, 60, 70].includes(roundsCount) && (
                      <option value="custom">{roundsCount} Rounds (Custom)</option>
                    )}
                  </select>
                  <input
                    id="wizard-total-rounds"
                    type="number"
                    min={1}
                    max={70}
                    value={roundsCount}
                    onChange={e => {
                      const val = Number(e.target.value);
                      if (!Number.isNaN(val)) {
                        setRoundsCount(Math.max(1, Math.min(70, Math.round(val))));
                      }
                    }}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono font-bold text-center tabular-nums"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Speed Round Timer (sec):</label>
                <input
                  type="number"
                  value={groupTimer}
                  onChange={e => setGroupTimer(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono font-bold"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Card Window (sec):</label>
                <input
                  type="number"
                  value={cardWindow}
                  onChange={e => setCardWindow(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono font-bold"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Reaction Window (sec):</label>
                <input
                  type="number"
                  value={reactionWindow}
                  onChange={e => setReactionWindow(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-mono font-bold"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Defensive Card Limit:</label>
                <select
                  value={defensiveCardLimit}
                  onChange={e => setDefensiveCardLimit(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                >
                  <option value="free_defense">Free Defense (even after attack card)</option>
                  <option value="counts_against_round_limit">Counts toward 1-card round limit</option>
                </select>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Player Lock Policy:</label>
                <select
                  value={playerLockMode}
                  onChange={e => setPlayerLockMode(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                >
                  <option value="two_players">Max 2 protected players</option>
                  <option value="two_uses_any">Max 2 card uses per match</option>
                </select>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Card Inspection Mode:</label>
                <select
                  value={cardInspectionMode}
                  onChange={e => setCardInspectionMode(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                >
                  <option value="reveal_all">Reveal all opponent cards</option>
                  <option value="reveal_one_random">Reveal 1 random opponent card</option>
                </select>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Player Swap Mode:</label>
                <select
                  value={playerSwapMode}
                  onChange={e => setPlayerSwapMode(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                >
                  <option value="must_compensate">Mandatory 1-for-1 Exchange (Enforced)</option>
                </select>
                <p className="text-[11px] text-slate-500">
                  Always exchanges 1 rival player for 1 teammate to keep rosters balanced.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Card Window Scope:</label>
                <select
                  value={cardWindowScope}
                  onChange={e => setCardWindowScope(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white font-bold"
                >
                  <option value="all_rounds">All rounds (Recommended)</option>
                  <option value="private_rounds_only">Private rounds only</option>
                </select>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="wizard-comeback-points" className="font-bold text-slate-300 block">
                    Comeback Bonus Reward (pts):
                  </label>
                  <span className="text-[11px] font-mono text-amber-400">Gap ≥ 500 pts</span>
                </div>
                <input
                  id="wizard-comeback-points"
                  type="number"
                  min={50}
                  step={50}
                  value={comebackBonusPoints}
                  onChange={e => setComebackBonusPoints(Math.max(50, Number(e.target.value) || 250))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-amber-300 font-mono font-bold"
                  title="Points awarded when last-place team solves the Comeback Bonus question"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Bonus Question Effect (+pts / %):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={questionBonusPoints}
                    onChange={e => setQuestionBonusPoints(Number(e.target.value))}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-emerald-300 font-mono font-bold"
                    title="Extra points awarded on Bonus Question"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={questionBonusChance}
                    onChange={e => setQuestionBonusChance(Number(e.target.value))}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-slate-200 font-mono font-bold text-center"
                    title="Bonus question probability (%)"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="font-bold text-slate-300 block">Minus Question Effect (-pts / %):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={questionMinusPoints}
                    onChange={e => setQuestionMinusPoints(Number(e.target.value))}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-rose-300 font-mono font-bold"
                    title="Penalty points deducted when Minus Question is answered wrong"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={questionMinusChance}
                    onChange={e => setQuestionMinusChance(Number(e.target.value))}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-slate-200 font-mono font-bold text-center"
                    title="Minus question probability (%)"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => updateWizardStep(4)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isAr ? 'الرجوع' : 'Back'}</span>
              </button>

              <button
                type="button"
                onClick={handleFinalizeGame}
                className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-black text-sm shadow-xl shadow-emerald-500/20 flex items-center gap-2"
              >
                <span>{isAr ? 'إنشاء المباراة وتجهيز الـ QR Code' : 'Create Game & Generate QR Code'}</span>
                <CheckCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Game Ready / Lobby */}
        {currentStep === 6 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
            <div className="space-y-2 max-w-md mx-auto">
              <div className="w-12 h-12 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-2xl mx-auto flex items-center justify-center font-bold">
                <Check className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-black text-white">
                {isAr ? 'المباراة جاهزة للانطلاق!' : 'Game Ready in Lobby!'}
              </h3>
              <p className="text-xs text-slate-400">
                Team leaders scan this QR Code with their phones to sign in and select their team.
              </p>
            </div>

            <div className="bg-slate-950 border-2 border-cyan-500/40 rounded-3xl p-6 max-w-sm mx-auto shadow-2xl space-y-4">
              {qrCodeDataUrl ? (
                <div className="bg-white p-3 rounded-2xl inline-block shadow-inner">
                  <img src={qrCodeDataUrl} alt="Match QR Code" className="w-56 h-56 mx-auto" />
                </div>
              ) : (
                <div className="w-56 h-56 bg-slate-900 animate-pulse rounded-2xl mx-auto flex items-center justify-center text-slate-500">
                  <QrCode className="w-10 h-10" />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-slate-400 font-mono">
                    {window.location.origin}/play?gameId={state?.gameId}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/play?gameId=${state?.gameId}`);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                  </button>

                  <a
                    href={`/play?gameId=${state?.gameId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-cyan-950 border border-cyan-800 text-xs font-bold text-cyan-300 hover:text-white flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Mobile Portal</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="max-w-sm mx-auto pt-2">
              <button
                type="button"
                onClick={startCompetition}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-black text-base shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Play className="w-5 h-5 fill-white" />
                <span>Start Competition Now</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
