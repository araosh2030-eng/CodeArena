import React, { useMemo, useState } from 'react';
import {
  Difficulty,
  Question,
  QuestionType,
  VerificationStatus,
} from '../../types/game';
import { isQuestionReadyForGame } from '../../game/rules';
import { AiAnalysisSummary } from '../../server/ai/aiSchemas';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Edit2,
  Eye,
  Flag,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';

export type ReviewFilter =
  | 'all'
  | 'mcq'
  | 'true_false'
  | 'programming'
  | 'verified'
  | 'needs_review'
  | 'missing'
  | 'conflicting';

interface AIReviewWorkspaceProps {
  questions: Question[];
  summary?: AiAnalysisSummary | null;
  extractionMethodLabel?: string;
  onUpdateQuestion: (id: string, updates: Partial<Question>) => void;
  onReplaceQuestion?: (updated: Question) => void;
  onDeleteQuestion: (id: string) => void;
  onClearAll?: () => void;
  maxHeightClass?: string;
}

const QUESTION_TYPE_OPTIONS: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'find_output',
  'code_completion',
  'complete_code',
  'debugging',
  'code_analysis',
  'programming',
  'short_answer',
];

const PROGRAMMING_TYPES = new Set<QuestionType>([
  'complete_code',
  'code_completion',
  'find_output',
  'debugging',
  'programming',
  'short_answer',
  'code_analysis',
]);

function statusMeta(status?: VerificationStatus): {
  label: string;
  tone: string;
} {
  switch (status) {
    case 'source_verified':
      return {
        label: 'Source Verified',
        tone: 'text-emerald-300 border-emerald-700/70 bg-emerald-950/60',
      };
    case 'ai_verified':
      return {
        label: 'AI Verified',
        tone: 'text-cyan-300 border-cyan-700/70 bg-cyan-950/60',
      };
    case 'conflicting':
      return {
        label: 'Conflicting Answer',
        tone: 'text-rose-300 border-rose-700/80 bg-rose-950/70',
      };
    case 'needs_teacher_review':
      return {
        label: 'Needs Review',
        tone: 'text-amber-300 border-amber-700/70 bg-amber-950/60',
      };
    case 'not_provided':
    default:
      return {
        label: 'Missing Answer',
        tone: 'text-amber-300 border-amber-700/70 bg-amber-950/40',
      };
  }
}

export const AIReviewWorkspace: React.FC<AIReviewWorkspaceProps> = ({
  questions,
  summary,
  extractionMethodLabel,
  onUpdateQuestion,
  onReplaceQuestion,
  onDeleteQuestion,
  onClearAll,
  maxHeightClass = 'max-h-[460px]',
}) => {
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sourceCompareId, setSourceCompareId] = useState<string | null>(null);
  const [reprocessingIds, setReprocessingIds] = useState<Record<string, boolean>>({});
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const isMissing = (q: Question) =>
      !q.correctAnswer || q.correctAnswer.trim().toUpperCase() === 'NOT PROVIDED';
    return {
      all: questions.length,
      mcq: questions.filter(q => q.type === 'multiple_choice').length,
      true_false: questions.filter(q => q.type === 'true_false').length,
      programming: questions.filter(q => PROGRAMMING_TYPES.has(q.type)).length,
      verified: questions.filter(
        q => q.verificationStatus === 'source_verified' || q.verificationStatus === 'ai_verified'
      ).length,
      needs_review: questions.filter(
        q => q.verificationStatus === 'needs_teacher_review' || !!q.flaggedForReview
      ).length,
      missing: questions.filter(isMissing).length,
      conflicting: questions.filter(q => q.verificationStatus === 'conflicting').length,
      approvedReady: questions.filter(isQuestionReadyForGame).length,
    };
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return questions.filter(q => {
      const isMissing =
        !q.correctAnswer || q.correctAnswer.trim().toUpperCase() === 'NOT PROVIDED';

      if (activeFilter === 'mcq' && q.type !== 'multiple_choice') return false;
      if (activeFilter === 'true_false' && q.type !== 'true_false') return false;
      if (activeFilter === 'programming' && !PROGRAMMING_TYPES.has(q.type)) return false;
      if (
        activeFilter === 'verified' &&
        q.verificationStatus !== 'source_verified' &&
        q.verificationStatus !== 'ai_verified'
      ) {
        return false;
      }
      if (
        activeFilter === 'needs_review' &&
        q.verificationStatus !== 'needs_teacher_review' &&
        !q.flaggedForReview
      ) {
        return false;
      }
      if (activeFilter === 'missing' && !isMissing) return false;
      if (activeFilter === 'conflicting' && q.verificationStatus !== 'conflicting') return false;

      if (query) {
        const hay = `${q.questionNumber || ''} ${q.questionText} ${q.codeSnippet || ''} ${
          q.programmingLanguage || ''
        } ${q.topic || ''} ${q.correctAnswer}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [questions, activeFilter, searchQuery]);

  const handleReprocess = async (q: Question) => {
    setReprocessError(null);
    setReprocessingIds(prev => ({ ...prev, [q.id]: true }));
    try {
      const res = await fetch('/api/questions/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok || !data.question) {
        setReprocessError(data.error || 'AI reprocessing failed.');
        return;
      }
      if (onReplaceQuestion) {
        onReplaceQuestion(data.question);
      } else {
        onUpdateQuestion(q.id, data.question);
      }
    } catch (err: any) {
      setReprocessError(err.message || 'Network error during reprocessing.');
    } finally {
      setReprocessingIds(prev => ({ ...prev, [q.id]: false }));
    }
  };

  const handleAcceptAiSuggestion = (q: Question) => {
    if (!q.aiSuggestedAnswer) return;
    onUpdateQuestion(q.id, {
      correctAnswer: q.aiSuggestedAnswer,
      answerStatus: 'provided',
      answerSource: 'ai_verified',
      verificationStatus: 'ai_verified',
      flaggedForReview: false,
      approved: true,
    });
  };

  const handleRejectAiSuggestion = (q: Question) => {
    const hasSource =
      Boolean(q.sourceAnswer && q.sourceAnswer.trim().length > 0 && q.sourceAnswer.trim().toUpperCase() !== 'NOT PROVIDED');
    onUpdateQuestion(q.id, {
      aiSuggestedAnswer: undefined,
      correctAnswer: hasSource ? q.sourceAnswer! : 'NOT PROVIDED',
      answerStatus: hasSource ? 'provided' : 'not_provided',
      verificationStatus: hasSource ? 'source_verified' : 'not_provided',
      flaggedForReview: false,
      approved: hasSource,
    });
  };

  const handleMarkNotProvided = (q: Question) => {
    onUpdateQuestion(q.id, {
      correctAnswer: 'NOT PROVIDED',
      answerStatus: 'not_provided',
      verificationStatus: 'not_provided',
      approved: false,
    });
  };

  const handleApproveAllVerified = () => {
    questions.forEach(q => {
      const hasBlockingErr = (q.qualityIssues || []).some(i => i.severity === 'error');
      const validAns =
        Boolean(q.correctAnswer && q.correctAnswer.trim().toUpperCase() !== 'NOT PROVIDED');
      if (
        !hasBlockingErr &&
        validAns &&
        !q.flaggedForReview &&
        q.verificationStatus !== 'conflicting' &&
        q.verificationStatus !== 'needs_teacher_review'
      ) {
        onUpdateQuestion(q.id, { approved: true });
      }
    });
  };

  const filterButtons: Array<{ id: ReviewFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'mcq', label: 'MCQ', count: counts.mcq },
    { id: 'true_false', label: 'True / False', count: counts.true_false },
    { id: 'programming', label: 'Programming', count: counts.programming },
    { id: 'verified', label: 'Verified', count: counts.verified },
    { id: 'needs_review', label: 'Needs Review', count: counts.needs_review },
    { id: 'missing', label: 'Missing Answers', count: counts.missing },
    { id: 'conflicting', label: 'Conflicting', count: counts.conflicting },
  ];

  if (questions.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Top Intelligence Summary Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-emerald-400 tabular-nums">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {counts.approvedReady} / {counts.all} Ready for Match
            </span>
          </div>

          {extractionMethodLabel && (
            <span className="text-[11px] font-mono text-slate-400 border-l border-slate-800 pl-3">
              {extractionMethodLabel}
            </span>
          )}

          {summary && (
            <span className="text-[11px] font-mono text-cyan-400 border-l border-slate-800 pl-3 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {summary.usedGemini ? `AI Engine: ${summary.modelUsed}` : 'Structured Analyzer'}
                {summary.cacheHit ? ' (Cached)' : ''}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApproveAllVerified}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/80 text-[11px] font-bold text-emerald-300"
          >
            Approve All Verified
          </button>
          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-[11px] font-bold text-rose-300"
            >
              Clear List
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterButtons.map(btn => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setActiveFilter(btn.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors tabular-nums ${
                activeFilter === btn.id
                  ? 'bg-cyan-600 border-cyan-400 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {btn.label} ({btn.count})
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-60 shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter by text, language, topic..."
            dir="ltr"
            className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          />
        </div>
      </div>

      {reprocessError && (
        <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{reprocessError}</span>
        </div>
      )}

      {/* Question Review List */}
      {filteredQuestions.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2">
          <p className="text-xs text-slate-400">No questions match the selected filter.</p>
          <button
            type="button"
            onClick={() => {
              setActiveFilter('all');
              setSearchQuery('');
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className={`${maxHeightClass} overflow-y-auto space-y-3 pr-1`} dir="ltr">
          {filteredQuestions.map((q, idx) => {
            const isMissingAns =
              !q.correctAnswer || q.correctAnswer.trim().toUpperCase() === 'NOT PROVIDED';
            const isConflicting = q.verificationStatus === 'conflicting';
            const isEditing = editingId === q.id;
            const showSourceCompare = sourceCompareId === q.id;
            const isReprocessing = !!reprocessingIds[q.id];
            const meta = statusMeta(q.verificationStatus);
            const hasBlockingError = (q.qualityIssues || []).some(i => i.severity === 'error');
            const readyForGame = isQuestionReadyForGame(q);

            return (
              <div
                key={q.id}
                className={`p-4 rounded-2xl border text-xs space-y-3 transition-colors ${
                  isConflicting
                    ? 'bg-rose-950/20 border-rose-600/70'
                    : isMissingAns
                    ? 'bg-amber-950/15 border-amber-700/60'
                    : readyForGame
                    ? 'bg-slate-950 border-slate-800'
                    : 'bg-slate-950/70 border-slate-800/80'
                }`}
              >
                {/* Header Row: Metadata + Action Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-mono font-black text-slate-300 tabular-nums">
                      {q.questionNumber || `#${idx + 1}`}
                    </span>
                    <span className="font-mono uppercase text-cyan-300 border-l border-slate-800 pl-2">
                      {q.type.replace(/_/g, ' ')}
                    </span>
                    {q.programmingLanguage && (
                      <span className="font-mono text-indigo-300 border-l border-slate-800 pl-2 flex items-center gap-1">
                        <Code2 className="w-3 h-3" />
                        <span>{q.programmingLanguage}</span>
                      </span>
                    )}
                    {q.topic && (
                      <span className="text-slate-400 border-l border-slate-800 pl-2">
                        {q.topic}
                      </span>
                    )}
                    {q.sourcePage && (
                      <span className="font-mono text-slate-500 border-l border-slate-800 pl-2 tabular-nums">
                        p.{q.sourcePage}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded border font-bold text-[10px] ${meta.tone}`}>
                      {meta.label}
                    </span>
                    {typeof q.answerConfidence === 'number' && q.answerConfidence > 0 && (
                      <span className="font-mono text-slate-400 tabular-nums text-[10px]">
                        {q.answerConfidence}% conf.
                      </span>
                    )}
                  </div>

                  {/* Per-Question Actions */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {q.sourceExcerpt && (
                      <button
                        type="button"
                        onClick={() => setSourceCompareId(showSourceCompare ? null : q.id)}
                        className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 border ${
                          showSourceCompare
                            ? 'bg-indigo-600 border-indigo-400 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>Compare</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isReprocessing}
                      onClick={() => handleReprocess(q)}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-indigo-300 flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isReprocessing ? 'animate-spin' : ''}`} />
                      <span>{isReprocessing ? 'Analyzing...' : 'Reprocess'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateQuestion(q.id, {
                          flaggedForReview: !q.flaggedForReview,
                          approved: q.flaggedForReview ? q.approved : false,
                        })
                      }
                      className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 border ${
                        q.flaggedForReview
                          ? 'bg-amber-600 border-amber-400 text-white'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-amber-300'
                      }`}
                    >
                      <Flag className="w-3 h-3" />
                      <span>{q.flaggedForReview ? 'Flagged' : 'Flag'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingId(isEditing ? null : q.id)}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-cyan-300 flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>{isEditing ? 'Done' : 'Edit'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isMissingAns || isConflicting || hasBlockingError}
                      onClick={() =>
                        onUpdateQuestion(q.id, {
                          approved: !q.approved,
                          flaggedForReview: false,
                        })
                      }
                      className={`px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${
                        q.approved && readyForGame
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      <span>{q.approved && readyForGame ? 'Approved' : 'Approve'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteQuestion(q.id)}
                      className="p-1 rounded bg-slate-900 hover:bg-rose-900 border border-slate-800 text-rose-400"
                      title="Delete question"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Quality Control Alerts */}
                {q.qualityIssues && q.qualityIssues.length > 0 && (
                  <div className="space-y-1">
                    {q.qualityIssues.map((iss, ii) => (
                      <div
                        key={ii}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                          iss.severity === 'error'
                            ? 'bg-rose-950/60 border-rose-700/80 text-rose-200'
                            : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono text-[10px] opacity-80">{iss.code}:</span>
                        <span>{iss.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Side-by-Side Source Excerpt Comparison */}
                {showSourceCompare && q.sourceExcerpt && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-900/90 border border-indigo-700/50">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-indigo-300 font-bold block">
                        Original Source Excerpt {q.sourcePage ? `(Page ${q.sourcePage})` : ''}
                      </span>
                      <pre className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {q.sourceExcerpt}
                      </pre>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-cyan-300 font-bold block">
                        Extracted Structure & Keys
                      </span>
                      <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] space-y-1 text-slate-300">
                        <div>
                          <span className="text-slate-500">Source Answer: </span>
                          <span className="font-mono text-emerald-300">
                            {q.sourceAnswer || 'NOT PROVIDED'}
                          </span>
                        </div>
                        {q.aiSuggestedAnswer && (
                          <div>
                            <span className="text-slate-500">AI Suggested: </span>
                            <span className="font-mono text-cyan-300">{q.aiSuggestedAnswer}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-slate-500">Active Answer: </span>
                          <span className="font-mono font-bold text-white">{q.correctAnswer}</span>
                        </div>
                        {q.answerExplanation && (
                          <div className="text-slate-400 pt-1 border-t border-slate-800">
                            {q.answerExplanation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Body: Edit Form OR Read View */}
                {isEditing ? (
                  <div className="space-y-2.5 pt-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-400">
                        Verbatim English Question Text
                      </label>
                      <textarea
                        rows={2}
                        value={q.questionText}
                        onChange={e => onUpdateQuestion(q.id, { questionText: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-400">
                        Code Snippet (Optional)
                      </label>
                      <textarea
                        rows={3}
                        value={q.codeSnippet || ''}
                        onChange={e =>
                          onUpdateQuestion(q.id, {
                            codeSnippet: e.target.value || undefined,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-cyan-200"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <select
                        value={q.type}
                        onChange={e =>
                          onUpdateQuestion(q.id, { type: e.target.value as QuestionType })
                        }
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                      >
                        {QUESTION_TYPE_OPTIONS.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>

                      <select
                        value={q.difficulty}
                        onChange={e =>
                          onUpdateQuestion(q.id, { difficulty: e.target.value as Difficulty })
                        }
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                      >
                        <option value="easy">easy</option>
                        <option value="medium">medium</option>
                        <option value="hard">hard</option>
                        <option value="expert">expert</option>
                      </select>

                      <input
                        type="text"
                        value={q.programmingLanguage || ''}
                        onChange={e =>
                          onUpdateQuestion(q.id, {
                            programmingLanguage: e.target.value || undefined,
                          })
                        }
                        placeholder="Language (Python, JS...)"
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
                      />

                      <input
                        type="text"
                        value={q.correctAnswer}
                        onChange={e => {
                          const val = e.target.value;
                          const valid = val.trim().length > 0 && val.trim().toUpperCase() !== 'NOT PROVIDED';
                          onUpdateQuestion(q.id, {
                            correctAnswer: val,
                            answerStatus: valid ? 'provided' : 'not_provided',
                            answerSource: valid ? 'teacher_manual' : 'none',
                            verificationStatus: valid ? 'source_verified' : 'not_provided',
                            flaggedForReview: false,
                          });
                        }}
                        placeholder="Correct Answer"
                        className="bg-slate-950 border border-cyan-600 rounded-lg p-2 text-xs font-mono text-emerald-300"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={(q.options || []).join(' | ')}
                        onChange={e =>
                          onUpdateQuestion(q.id, {
                            options: e.target.value
                              .split('|')
                              .map(s => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="MCQ Options separated by | (leave blank if open-ended)"
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
                      />

                      <input
                        type="text"
                        value={(q.acceptedAnswers || []).join(' | ')}
                        onChange={e =>
                          onUpdateQuestion(q.id, {
                            acceptedAnswers: e.target.value
                              .split('|')
                              .map(s => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Alternative Accepted Answers separated by |"
                        className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="font-bold text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                      {q.questionText}
                    </p>

                    {q.codeSnippet && (
                      <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-cyan-200 overflow-x-auto leading-relaxed">
                        {q.codeSnippet}
                      </pre>
                    )}

                    {q.options && q.options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {q.options.map((opt, oi) => {
                          const isCurrentAns =
                            !isMissingAns &&
                            opt.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
                          return (
                            <div
                              key={oi}
                              className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                                isCurrentAns
                                  ? 'bg-emerald-950/60 border-emerald-600/80 text-emerald-200 font-bold'
                                  : 'bg-slate-900 border-slate-800 text-slate-300'
                              }`}
                            >
                              <span className="font-mono text-cyan-400 font-bold">
                                {['A', 'B', 'C', 'D', 'E'][oi] || oi + 1})
                              </span>
                              <span>{opt}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Source Answer / AI Suggestion / Actions Footer */}
                    <div className="pt-2 border-t border-slate-900 flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`font-mono font-bold ${
                              isMissingAns
                                ? 'text-amber-400'
                                : isConflicting
                                ? 'text-rose-300'
                                : 'text-emerald-400'
                            }`}
                          >
                            Answer Key: {q.correctAnswer}
                          </span>
                          {q.acceptedAnswers && q.acceptedAnswers.length > 0 && (
                            <span className="text-[11px] font-mono text-slate-400">
                              Also accepted: {q.acceptedAnswers.join(' | ')}
                            </span>
                          )}
                        </div>

                        {q.aiSuggestedAnswer &&
                          q.aiSuggestedAnswer.trim().toLowerCase() !==
                            q.correctAnswer.trim().toLowerCase() && (
                            <div className="text-[11px] font-mono text-cyan-300 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span>AI Suggested Answer: {q.aiSuggestedAnswer}</span>
                            </div>
                          )}

                        {q.answerExplanation && (
                          <p className="text-[11px] text-slate-400 leading-snug">
                            {q.answerExplanation}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {q.aiSuggestedAnswer &&
                          (isMissingAns || isConflicting) && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAcceptAiSuggestion(q)}
                                className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold flex items-center gap-1"
                              >
                                <Check className="w-3 h-3" />
                                <span>Accept AI Suggestion</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRejectAiSuggestion(q)}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold flex items-center gap-1"
                              >
                                <XCircle className="w-3 h-3" />
                                <span>Reject</span>
                              </button>
                            </>
                          )}

                        {!isMissingAns && (
                          <button
                            type="button"
                            onClick={() => handleMarkNotProvided(q)}
                            className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-amber-300"
                          >
                            Mark NOT PROVIDED
                          </button>
                        )}

                        {isMissingAns && !q.aiSuggestedAnswer && (
                          <button
                            type="button"
                            onClick={() => setEditingId(q.id)}
                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold"
                          >
                            Enter Answer Key
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
