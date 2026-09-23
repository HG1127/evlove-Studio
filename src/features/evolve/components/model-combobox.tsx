// 可搜索的模型选择框：点开即展示全量列表（测试通过的置顶标 ✓），
// 输入只作为「搜索词」过滤、不覆盖已选中的值——不用先删掉当前模型才能重新选；
// 收起时搜索词按自定义模型 ID 提交（Enter 或点击别处），Esc 取消还原。
// 下拉用 fixed + portal 渲染：既不被卡片圆角裁切，也不被路由表格的 overflow 容器裁切。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isPlausibleModelId } from "../ai/providers/registry";

type ModelComboboxProps = {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  placeholder?: string;
  className?: string;
  /** 测试通过的模型：在列表里置顶并标 ✓，方便一键切回。 */
  tested?: string[];
  /** 模型备注（模型 ID → 备注文本）：跟随显示在模型名后，搜索时也匹配备注。 */
  notes?: Record<string, string>;
};

export function ModelCombobox({ models, value, onChange, placeholder, className, tested, notes }: ModelComboboxProps) {
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const open = coords !== null;

  const place = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ left: rect.left, top: rect.bottom + 4, width: Math.min(Math.max(rect.width, 240), 420) });
  }, []);

  // 收起时把搜索词提交为自定义模型 ID（Enter / 点击别处）；Esc 取消、还原为已选值。
  const close = useCallback((commit: boolean) => {
    if (commit) {
      const typed = search.trim();
      if (typed && typed !== value) onChange(typed);
    }
    setSearch("");
    setCoords(null);
  }, [onChange, search, value]);

  useEffect(() => {
    if (!coords) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      close(true);
    };
    // 页面滚动 / 窗口变化时跟随输入框重新定位，而不是直接关掉：
    // 下拉列表自身是可滚动区域，输入时页面高度也可能微变，一律关闭会让选择中途被打断。
    const onMove = (event: Event) => {
      if (event.type === "scroll" && dropdownRef.current?.contains(event.target as Node)) return;
      place();
    };
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [coords, place, close]);

  // 误敲的片段名（「g」「gp」）不进候选列表：只在输入框里作为当前输入存在。
  const unique = useMemo(() => [...new Set(models.filter((model) => isPlausibleModelId(model)))], [models]);
  const testedList = useMemo(() => [...new Set((tested ?? []).filter((model) => isPlausibleModelId(model)))], [tested]);
  const keyword = search.trim().toLowerCase();
  // 备注也参与匹配：搜「评测」能找到备注为「独立评测」的模型。
  const matchesKeyword = useCallback(
    (model: string) =>
      model.toLowerCase().includes(keyword) || (notes?.[model] ?? "").toLowerCase().includes(keyword),
    [keyword, notes],
  );
  const filtered = useMemo(() => (keyword ? unique.filter(matchesKeyword) : unique), [unique, keyword, matchesKeyword]);
  // 测通过的模型置顶成单独一组（即使模型列表后来重新同步也不会丢），其余排在后面。
  const testedTop = useMemo(() => (keyword ? testedList.filter(matchesKeyword) : testedList), [testedList, keyword, matchesKeyword]);
  const rest = useMemo(() => filtered.filter((model) => !testedTop.includes(model)), [filtered, testedTop]);
  // 键盘导航用扁平顺序：测通组在前、其余在后，与视觉顺序一致。
  const ordered = useMemo(() => [...testedTop, ...rest], [testedTop, rest]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const navigableIndex = activeIndex >= 0 && activeIndex < ordered.length ? activeIndex : -1;
  useEffect(() => {
    if (navigableIndex < 0) return;
    dropdownRef.current?.querySelector(`[data-idx="${navigableIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [navigableIndex]);

  const pick = (model: string) => {
    onChange(model);
    setSearch("");
    setActiveIndex(-1);
    setCoords(null);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={className}
        value={open ? search : value}
        placeholder={placeholder}
        onChange={(event) => {
          setSearch(event.target.value);
          setActiveIndex(-1);
          if (!coords) place();
        }}
        onFocus={() => {
          setSearch("");
          setActiveIndex(-1);
          place();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close(false);
            return;
          }
          // 收起态：下方向键 / Enter 重新展开并定位第一项
          if (!open) {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              setSearch("");
              setActiveIndex(0);
              place();
            }
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => {
              const index = current >= 0 && current < ordered.length ? current : -1;
              return Math.min(index + 1, ordered.length - 1);
            });
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => {
              if (!ordered.length) return -1;
              const index = current >= 0 && current < ordered.length ? current : 0;
              return Math.max(index - 1, 0);
            });
          } else if (event.key === "Enter") {
            event.preventDefault();
            const target = navigableIndex >= 0 ? ordered[navigableIndex] : undefined;
            if (target) pick(target);
            else close(true);
          }
        }}
      />
      {coords &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-50 max-h-60 overflow-auto rounded-xl border bg-white p-1 shadow-xl"
            style={{ left: coords.left, top: coords.top, width: coords.width }}
          >
            <div className="px-2 py-1 text-[10px] text-slate-400">
              {keyword
                ? `匹配 ${testedTop.length + rest.length} / ${unique.length} 个`
                : testedTop.length
                  ? `${testedTop.length} 个测试通过 · 共 ${unique.length} 个 · 输入可筛选`
                  : `共 ${unique.length} 个模型 · 输入可筛选`}
            </div>
            {!!testedTop.length && (
              <>
                <div className="px-2 pt-1 text-[10px] font-semibold text-emerald-600">✓ 测试通过 · 点击一键切回</div>
                {testedTop.map((model, index) => (
                  <button
                    key={`tested-${model}`}
                    type="button"
                    data-idx={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(model);
                    }}
                    className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${index === activeIndex ? "bg-emerald-50" : "hover:bg-emerald-50"} ${model === value ? "font-semibold text-emerald-700" : "text-emerald-700"}`}
                  >
                    ✓ {model}
                    {notes?.[model] && <span className="ml-1.5 font-normal text-slate-400">· {notes[model]}</span>}
                  </button>
                ))}
                {!!rest.length && <div className="my-1 h-px bg-slate-100" />}
              </>
            )}
            {rest.map((model, rowIndex) => {
              const index = testedTop.length + rowIndex;
              return (
                <button
                  key={model}
                  type="button"
                  data-idx={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(model);
                  }}
                  className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${index === activeIndex ? "bg-indigo-50" : "hover:bg-indigo-50"} ${model === value ? "font-semibold text-indigo-600" : "text-slate-700"}`}
                >
                  {model}
                  {notes?.[model] && <span className="ml-1.5 text-slate-400">· {notes[model]}</span>}
                </button>
              );
            })}
            {!testedTop.length && !rest.length && (
              <div className="px-2 py-2 text-xs leading-5 text-slate-400">
                {unique.length ? "没有匹配的模型；按 Enter 将当前输入作为自定义模型 ID 使用" : "暂无已同步模型；输入模型 ID 后按 Enter 即可使用"}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
