import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  Grid, 
  List as ListIcon, 
  Search, 
  X, 
  ExternalLink, 
  Copy, 
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Tag,
  Upload,
  Play,
  FileJson,
  FileSpreadsheet,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Save,
  LayoutDashboard,
  FileUp,
  AlertCircle,
  Code
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { IMAGE_URLS } from './constants';

// --- Types ---

interface TagDefinition {
  tag: string;
  title1: string;
  title2: string;
  content?: string; // Description text
}

interface ImageItem {
  id: string; // Internal unique ID for React keys
  url: string;
  filename: string;
  tags: string[]; // Stores just the tag string (key)
  // Metadata from Excel/CSV
  hotelId?: string | number;
  hotelName?: string;
  originalImageId?: string | number; 
}

type ViewMode = 'grid' | 'list' | 'summary';
type AppStep = 'setup' | 'labeling';

// --- Components ---

const SetupScreen = ({ 
  onStart, 
  onLoadDemo,
  onImportSession
}: { 
  onStart: (data: ImageItem[], tagDefs: TagDefinition[]) => void;
  onLoadDemo: () => void;
  onImportSession: (data: ImageItem[], tagDefs: TagDefinition[]) => void;
}) => {
  // Data Source State
  const [loadedImages, setLoadedImages] = useState<ImageItem[]>([]);
  const [uploadFileName, setUploadFileName] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Tag Management State
  const [rawTagInput, setRawTagInput] = useState('');
  const [parsedTags, setParsedTags] = useState<TagDefinition[]>([]);
  const [tagParseError, setTagParseError] = useState<string | null>(null);
  
  // File Refs
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Parse Tags when input changes
  useEffect(() => {
    if (!rawTagInput.trim()) {
      setParsedTags([]);
      setTagParseError(null);
      return;
    }

    try {
      // 1. Attempt to sanitize Python-style string representation to JSON
      // Replace single quotes with double quotes
      // Note: This is a basic heuristic. 
      let sanitized = rawTagInput
        .replace(/'/g, '"') 
        .replace(/None/g, 'null')
        .replace(/True/g, 'true')
        .replace(/False/g, 'false');

      let data: any;
      try {
        data = JSON.parse(sanitized);
      } catch (e) {
        setTagParseError("格式无效。请确保是有效的 JSON 或 Python 列表语法。");
        return;
      }

      if (!Array.isArray(data)) {
        setTagParseError("根元素必须是列表/数组 (List/Array)。");
        return;
      }

      const definitions: TagDefinition[] = [];
      const seenTags = new Set<string>();

      // Extract logic based on the provided structure:
      // [{'short_point': [{'title1':..., 'title2':..., 'tag':..., 'content':...}]}]
      data.forEach((item: any, index: number) => {
        if (item.short_point && Array.isArray(item.short_point)) {
          item.short_point.forEach((sp: any) => {
            if (sp.tag && !seenTags.has(sp.tag)) {
              definitions.push({
                tag: sp.tag,
                title1: sp.title1 || '',
                title2: sp.title2 || '',
                content: sp.content || ''
              });
              seenTags.add(sp.tag);
            }
          });
        }
      });

      if (definitions.length === 0) {
        setTagParseError("在提供的数据结构中未找到 'short_point' 标签。");
      } else {
        setParsedTags(definitions);
        setTagParseError(null);
      }
    } catch (err) {
      setTagParseError("解析文本时出错，请检查语法。");
    }
  }, [rawTagInput]);

  const handleStart = () => {
    if (loadedImages.length === 0) {
      alert("请先上传包含图片数据的文件。");
      return;
    }
    if (parsedTags.length === 0) {
       if (!confirm("未定义标签。是否在无标签的情况下继续？")) return;
    }
    onStart(loadedImages, parsedTags);
  };

  // Handle Loading Previous Session (JSON)
  const handleJsonSessionUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (Array.isArray(json) && json.length > 0) {
          
          // Check if it's the Flat Format (has "tag name" key) or Legacy Nested Format
          const isFlatFormat = "tag name" in json[0] || "tag_name" in json[0];

          if (isFlatFormat) {
             // --- Handle Flat Format Import ---
             const groupedImages = new Map<string, ImageItem>();
             const recoveredDefs = new Map<string, TagDefinition>();

             json.forEach((row: any) => {
                const url = row.image_url;
                if (!url) return;
                
                // Group by URL (primary key for reconstruction)
                if (!groupedImages.has(url)) {
                   groupedImages.set(url, {
                      id: row.image_id ? `restored-${row.image_id}` : `img-restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      url: url,
                      filename: url.split('/').pop() || 'unknown',
                      tags: [],
                      hotelId: row.hotel_id,
                      hotelName: row.hotel_name, // Might be undefined if imported from strict export
                      originalImageId: row.image_id
                   });
                }

                const img = groupedImages.get(url)!;
                const tagName = row["tag name"] || row["tag_name"]; // Handle potentially different casing keys
                
                if (tagName && typeof tagName === 'string' && tagName.trim() !== '') {
                   if (!img.tags.includes(tagName)) {
                      img.tags.push(tagName);
                   }
                   // Recover definition
                   if (!recoveredDefs.has(tagName)) {
                      recoveredDefs.set(tagName, {
                         tag: tagName,
                         title1: row.title1 || '',
                         title2: row.title2 || '',
                         content: row.content || '' // Might be undefined if imported from strict export
                      });
                   }
                }
             });

             onImportSession(Array.from(groupedImages.values()), Array.from(recoveredDefs.values()));

          } else {
             // --- Handle Legacy Nested Format Import ---
             const restoredImages: ImageItem[] = json.map((item, idx) => ({
               id: item.image_id ? `restored-${item.image_id}` : `img-restored-${Date.now()}-${idx}`,
               url: item.image_url, 
               filename: (item.image_url || '').split('/').pop() || 'unknown',
               tags: Array.isArray(item.tags) ? item.tags.map((t: any) => typeof t === 'string' ? t : t.tag) : [],
               hotelId: item.hotel_id,
               hotelName: item.hotel_name,
               originalImageId: item.image_id
             })).filter(item => item.url); 

             const recoveredDefs: TagDefinition[] = [];
             const seen = new Set<string>();

             json.forEach((row: any) => {
                if (Array.isArray(row.tags)) {
                   row.tags.forEach((t: any) => {
                      if (typeof t === 'object' && t.tag && !seen.has(t.tag)) {
                         recoveredDefs.push({
                           tag: t.tag,
                           title1: t.title1 || '',
                           title2: t.title2 || '',
                           content: t.content || ''
                         });
                         seen.add(t.tag);
                      } else if (typeof t === 'string' && !seen.has(t)) {
                         recoveredDefs.push({ tag: t, title1: '', title2: '' });
                         seen.add(t);
                      }
                   });
                }
             });

             if(restoredImages.length > 0) {
               onImportSession(restoredImages, recoveredDefs);
             } else {
               alert("JSON 中未找到有效的图片数据。");
             }
          }
        } else {
          alert("无效的 JSON 格式或文件为空。");
        }
      } catch (err) {
        console.error(err);
        alert("解析 JSON 文件时出错。");
      }
    };
    reader.readAsText(file);
    if (jsonInputRef.current) jsonInputRef.current.value = '';
  };

  // Handle Excel/CSV Upload for New Data Source
  const handleExcelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

        if (jsonData.length === 0) {
          setUploadError("电子表格似乎为空。");
          return;
        }

        // Auto-detect columns (case-insensitive fuzzy match)
        const firstRow = jsonData[0];
        const keys = Object.keys(firstRow);
        
        const findKey = (patterns: RegExp[]) => 
          keys.find(k => patterns.some(p => p.test(k)));

        // Heuristics
        const urlKey = findKey([/^image_url$/i, /^url$/i, /^link$/i, /^src$/i, /link/i, /url/i]);
        const hotelIdKey = findKey([/^hotel_id$/i, /^hotelid$/i, /^hotel$/i, /hotel_id/i]);
        const hotelNameKey = findKey([/^hotel_name$/i, /^hotelname$/i, /^name$/i, /^hotel name$/i]);
        const imageIdKey = findKey([/^image_id$/i, /^imageid$/i, /^id$/i, /image_id/i]);

        if (!urlKey && !keys.some(k => String(firstRow[k]).startsWith('http'))) {
          setUploadError("未能检测到 'image_url' 列。请检查您的文件表头。");
          return;
        }

        const effectiveUrlKey = urlKey || keys.find(k => String(firstRow[k]).startsWith('http'));
        
        if (!effectiveUrlKey) {
          setUploadError("未找到有效的 URL 列。");
          return;
        }

        const parsedItems: ImageItem[] = jsonData
          .filter(row => row[effectiveUrlKey]) 
          .map((row, idx) => {
            const url = String(row[effectiveUrlKey]).trim();
            const filename = url.split('/').pop()?.split('?')[0] || `image-${idx}.jpg`;
            return {
              id: `img-xlsx-${Date.now()}-${idx}`,
              url: url,
              filename: filename,
              tags: [], 
              hotelId: hotelIdKey ? row[hotelIdKey] : undefined,
              hotelName: hotelNameKey ? row[hotelNameKey] : undefined,
              originalImageId: imageIdKey ? row[imageIdKey] : undefined
            };
          });

        if (parsedItems.length === 0) {
          setUploadError("未提取到有效行。");
        } else {
          setLoadedImages(parsedItems);
          setUploadFileName(file.name);
        }

      } catch (err) {
        console.error(err);
        setUploadError("文件解析失败。请确保是有效的 Excel 或 CSV 文件。");
      }
    };
    
    reader.readAsArrayBuffer(file);
    if (excelInputRef.current) excelInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-slate-950 font-sans">
      <div className="max-w-6xl w-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col md:flex-row h-full md:h-[700px]">
        
        {/* Left Panel: Info & Actions */}
        <div className="md:w-1/3 bg-slate-50 dark:bg-slate-800/50 p-8 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-600/20">
                <ImageIcon className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Pavo 图片库</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">图片标注工具</p>
              </div>
            </div>
            
            <div className="space-y-6 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm border border-slate-100 dark:border-slate-600">1</span>
                <p className="mt-1">上传包含 <b>image_url</b>, <b>hotel_id</b>, <b>hotel_name</b> 和 <b>image_id</b> 的 Excel/CSV 文件。</p>
              </div>
              <div className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm border border-slate-100 dark:border-slate-600">2</span>
                <p className="mt-1">粘贴您的亮点文本块，自动提取 <b>tags</b> (标签), <b>title1</b>, 和 <b>title2</b>。</p>
              </div>
              <div className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm border border-slate-100 dark:border-slate-600">3</span>
                <p className="mt-1">以扁平格式导出为 JSON。</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 mt-8">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">其他选项</h3>
            <button
              onClick={onLoadDemo}
              className="w-full py-3 px-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm text-left flex items-center gap-3"
            >
              <LayoutDashboard className="w-4 h-4 text-slate-400" />
              加载演示数据
            </button>

            <div className="relative">
              <input
                ref={jsonInputRef}
                type="file"
                accept=".json"
                onChange={handleJsonSessionUpload}
                className="hidden"
              />
              <button
                onClick={() => jsonInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium hover:border-green-400 dark:hover:border-green-500 hover:text-green-600 dark:hover:text-green-400 transition-all text-sm text-left flex items-center gap-3 group"
              >
                <FileJson className="w-4 h-4 text-slate-400 group-hover:text-green-500" />
                <span>恢复会话 (JSON)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Form */}
        <div className="md:w-2/3 p-8 flex flex-col bg-slate-50/30 dark:bg-slate-900">
          <div className="flex-1 space-y-6 overflow-y-auto pr-2">
            
            {/* File Upload Section */}
            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                1. 数据源 (Excel/CSV)
              </label>
              <div 
                onClick={() => excelInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200 group
                  ${uploadFileName 
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10' 
                    : 'border-slate-300 dark:border-slate-700 hover:border-blue-400 hover:bg-white dark:hover:bg-slate-800'
                  }
                `}
              >
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleExcelUpload}
                  className="hidden"
                />
                
                {loadedImages.length > 0 ? (
                  <div className="flex flex-row items-center justify-center gap-4 animate-fade-in">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-slate-900 dark:text-white font-medium text-sm">{uploadFileName}</p>
                      <p className="text-slate-500 text-xs">{loadedImages.length} 张图片</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <FileUp className="w-8 h-8 text-slate-300 group-hover:text-blue-500 mb-2 transition-colors" />
                    <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">点击上传 Excel/CSV 文件</p>
                    {uploadError && (
                      <p className="mt-2 text-red-500 text-xs">{uploadError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tag Input Section */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                2. 亮点配置 (粘贴文本)
              </label>
              
              <div className="flex-1 flex flex-col gap-2">
                <div className="relative flex-1">
                  <textarea
                    className="w-full h-32 md:h-40 px-4 py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs font-mono text-slate-700 dark:text-slate-200 placeholder-slate-400 transition-all shadow-sm resize-none"
                    placeholder="在此粘贴 Python 风格的列表... 例如 [{'short_point': [{'title1': '...', 'tag': '...', 'content': '...'}]}]"
                    value={rawTagInput}
                    onChange={(e) => setRawTagInput(e.target.value)}
                  />
                  <div className="absolute top-2 right-2">
                     <Code className="w-4 h-4 text-slate-300" />
                  </div>
                </div>

                {/* Validation Status */}
                {rawTagInput && (
                   <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${tagParseError ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-green-50 text-green-700 dark:bg-green-900/20'}`}>
                      {tagParseError ? (
                        <>
                          <AlertCircle className="w-4 h-4" />
                          {tagParseError}
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          找到 {parsedTags.length} 个有效标签
                        </>
                      )}
                   </div>
                )}

                {/* Tag Preview */}
                <div className="h-28 overflow-y-auto p-3 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-wrap content-start gap-2">
                  {parsedTags.length === 0 && !tagParseError && (
                    <div className="w-full text-center text-slate-400 text-xs italic py-2">
                      粘贴后在此预览标签...
                    </div>
                  )}
                  
                  {parsedTags.map((t, index) => (
                    <div 
                      key={index} 
                      className="flex flex-col bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 shadow-sm max-w-[150px]"
                    >
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{t.tag}</span>
                      <span className="text-[10px] text-slate-500 truncate">{t.title1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleStart}
              disabled={loadedImages.length === 0 || (rawTagInput.length > 0 && parsedTags.length === 0)}
              className={`
                w-full flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-bold text-lg transition-all duration-200 shadow-xl
                ${(loadedImages.length > 0 && (!rawTagInput || parsedTags.length > 0))
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:-translate-y-0.5 shadow-blue-600/30' 
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                }
              `}
            >
              <Play className="w-5 h-5 fill-current" />
              开始标注
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Header = ({ 
  viewMode, 
  setViewMode, 
  searchTerm, 
  setSearchTerm, 
  totalCount,
  labeledCount,
  onExport,
  onReset
}: { 
  viewMode: ViewMode; 
  setViewMode: (mode: ViewMode) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  totalCount: number;
  labeledCount: number;
  onExport: () => void;
  onReset: () => void;
}) => (
  <header className="sticky top-0 z-40 w-full backdrop-blur-lg bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 transition-all duration-200">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
      {/* Brand */}
      <div className="flex items-center gap-3 min-w-fit cursor-pointer group" onClick={onReset} title="返回设置页">
        <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform">
          <ImageIcon className="w-6 h-6 text-white" />
        </div>
        <div className="hidden sm:block">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
            标注器
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            已标注 {labeledCount} / {totalCount}
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-1 max-w-lg relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2.5 border-none bg-slate-100 dark:bg-slate-800 rounded-full leading-5 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 sm:text-sm"
          placeholder="搜索名称、ID 或标签..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onExport}
          className="hidden sm:flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          title="导出 JSON"
        >
          <FileJson className="w-4 h-4" />
          导出
        </button>

        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-md transition-all duration-200 ${
              viewMode === 'grid' 
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            title="网格视图"
          >
            <Grid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-md transition-all duration-200 ${
              viewMode === 'list' 
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            title="列表视图"
          >
            <ListIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('summary')}
            className={`p-2 rounded-md transition-all duration-200 ${
              viewMode === 'summary' 
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            title="汇总视图"
          >
            <LayoutDashboard className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  </header>
);

const TagBadge: React.FC<{ label: string; active: boolean; onClick?: (e: React.MouseEvent) => void }> = ({ label, active, onClick }) => (
  <span 
    onClick={onClick}
    className={`
      inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all duration-200
      ${onClick ? 'cursor-pointer hover:scale-105 select-none' : ''}
      ${active 
        ? 'bg-blue-500 text-white shadow-sm' 
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 ring-1 ring-inset ring-slate-500/10 hover:ring-slate-500/30'
      }
    `}
  >
    {active && <CheckCircle2 className="w-3 h-3" />}
    {label}
  </span>
);

const ImageCard: React.FC<{ 
  image: ImageItem; 
  onClick: () => void;
}> = ({ 
  image, 
  onClick 
}) => (
  <div 
    onClick={onClick}
    className={`
      group relative mb-4 break-inside-avoid rounded-xl overflow-hidden cursor-pointer 
      bg-slate-200 dark:bg-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300
      ${image.tags.length > 0 ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}
    `}
  >
    <img
      src={image.url}
      alt={image.filename}
      loading="lazy"
      className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105"
    />
    
    {/* Tags Overlay */}
    <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1">
      {image.tags.map(tag => (
        <TagBadge key={tag} label={tag} active={true} />
      ))}
    </div>

    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end">
      <div className="p-4 w-full">
        <p className="text-white text-sm font-medium truncate">{image.filename}</p>
        {(image.originalImageId || image.hotelId) && (
             <p className="text-white/70 text-xs mt-0.5 truncate">
               {image.hotelId ? `H:${image.hotelId} ` : ''} 
               {image.originalImageId ? `ID:${image.originalImageId}` : ''}
             </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button 
            className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg text-white hover:bg-white/40 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              window.open(image.url, '_blank');
            }}
            title="打开原图"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button 
            className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg text-white hover:bg-white/40 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(image.url);
            }}
            title="复制链接"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const ListView = ({ images, onSelect }: { images: ImageItem[]; onSelect: (img: ImageItem) => void }) => (
  <div className="max-w-5xl mx-auto p-4">
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {images.map((img) => (
          <li 
            key={img.id} 
            className="group flex items-center justify-between p-4 hover:bg-blue-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
            onClick={() => onSelect(img)}
          >
            <div className="flex items-center gap-4 overflow-hidden flex-1">
              <div className="w-12 h-12 flex-shrink-0 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 relative">
                 <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                 {img.tags.length > 0 && (
                   <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                     <CheckCircle2 className="w-6 h-6 text-white drop-shadow-md" />
                   </div>
                 )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {img.filename}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500 mt-0.5">
                   {img.hotelId && <span>酒店: {img.hotelId}</span>}
                   {img.originalImageId && <span>图片ID: {img.originalImageId}</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {img.tags.length > 0 ? (
                    img.tags.map(tag => (
                      <span key={tag} className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400 italic">无标签</span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 ml-4">
              <button 
                className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="打开"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(img.url, '_blank');
                }}
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

const SummaryView = ({ 
  images, 
  availableTags, 
  onSelect 
}: { 
  images: ImageItem[]; 
  availableTags: TagDefinition[]; 
  onSelect: (img: ImageItem) => void 
}) => {
  const groupedImages = useMemo(() => {
    const groups: Record<string, ImageItem[]> = {};
    availableTags.forEach(def => {
      groups[def.tag] = [];
    });
    groups["未标注"] = [];

    images.forEach(img => {
      if (img.tags.length === 0) {
        groups["未标注"].push(img);
      } else {
        img.tags.forEach(tag => {
          if (groups[tag]) groups[tag].push(img);
        });
      }
    });
    return groups;
  }, [images, availableTags]);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-8">
      {["未标注", ...availableTags.map(t => t.tag)].map((groupName) => {
        const groupImages = groupedImages[groupName];
        if (!groupImages || groupImages.length === 0) return null;

        return (
          <div key={groupName} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {groupName === "未标注" ? (
                  <span className="w-3 h-3 rounded-full bg-slate-300"></span>
                ) : (
                  <Tag className="w-5 h-5 text-blue-500" />
                )}
                {groupName}
                <span className="text-sm font-normal text-slate-500 ml-2 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                  {groupImages.length}
                </span>
              </h3>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {groupImages.map(img => (
                <div 
                  key={img.id} 
                  onClick={() => onSelect(img)}
                  className="aspect-square relative group cursor-pointer rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:ring-2 hover:ring-blue-500 transition-all"
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      
      {/* Empty State if all groups are empty (shouldn't happen if there are images, but good safety) */}
      {images.length === 0 && (
        <div className="text-center py-10 text-slate-500">无可汇总的图片。</div>
      )}
    </div>
  );
};

const Lightbox = ({ 
  image, 
  availableTags,
  onToggleTag,
  onClose,
  onNext,
  onPrev,
  hasPrev,
  hasNext,
  currentIndex,
  totalCount
}: { 
  image: ImageItem; 
  availableTags: TagDefinition[];
  onToggleTag: (tag: string) => void;
  onClose: () => void; 
  onNext: () => void;
  onPrev: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  currentIndex: number;
  totalCount: number;
}) => {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && hasNext) onNext();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose, onNext, onPrev, hasNext, hasPrev]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:flex-row bg-slate-950/95 backdrop-blur-md animate-fade-in">
      {/* Main Image Area */}
      <div className="relative flex-1 h-full flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
        {/* Navigation Buttons (Floating) */}
        {hasPrev && (
          <button 
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-50 backdrop-blur-md"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
        )}
        
        {hasNext && (
          <button 
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-50 backdrop-blur-md"
          >
            <ChevronRight className="w-8 h-8" />
          </button>
        )}

        <img 
          src={image.url} 
          alt={image.filename} 
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85vh] w-auto max-w-full object-contain rounded-lg shadow-2xl"
        />
        
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          <button 
            onClick={onClose}
            className="p-3 rounded-full bg-white/10 text-white hover:bg-red-500/80 transition-colors backdrop-blur-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Sidebar / Controls Panel */}
      <div 
        className="w-full sm:w-80 bg-white dark:bg-slate-900 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto shadow-2xl z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-lg text-slate-900 dark:text-white mb-1">标注图片</h3>
            <p className="text-xs text-slate-500 break-all">{image.filename}</p>
            {(image.hotelId || image.originalImageId) && (
              <div className="flex flex-col gap-0.5 mt-2">
                 {image.hotelId && <span className="text-xs font-mono text-slate-400">酒店 ID: {image.hotelId}</span>}
                 {image.hotelName && <span className="text-xs font-mono text-slate-400 block">{image.hotelName}</span>}
                 {image.originalImageId && <span className="text-xs font-mono text-slate-400 block">图片 ID: {image.originalImageId}</span>}
              </div>
            )}
          </div>
          <div className="flex-shrink-0 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-xs font-mono font-medium text-slate-600 dark:text-slate-400">
            {currentIndex + 1} / {totalCount}
          </div>
        </div>

        <div className="flex-1">
          <label className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 block">可用标签</label>
          <div className="flex flex-col gap-2">
            {availableTags.length > 0 ? availableTags.map(def => (
              <button
                key={def.tag}
                onClick={() => onToggleTag(def.tag)}
                className={`
                  flex items-center justify-between px-3 py-3 rounded-lg text-left transition-all
                  ${image.tags.includes(def.tag)
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 transform scale-105'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                     {image.tags.includes(def.tag) ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <Plus className="w-3.5 h-3.5 flex-shrink-0" />}
                     <span className="font-medium text-sm truncate">{def.tag}</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 truncate ${image.tags.includes(def.tag) ? 'text-blue-100' : 'text-slate-400'}`}>
                    {def.title1} / {def.title2}
                  </div>
                  {def.content && (
                    <div className={`text-[10px] mt-0.5 leading-tight line-clamp-2 ${image.tags.includes(def.tag) ? 'text-blue-100/80' : 'text-slate-400/80'}`}>
                      {def.content}
                    </div>
                  )}
                </div>
              </button>
            )) : (
              <p className="text-sm text-slate-400 italic">未定义标签。</p>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-6 mt-auto">
          <div className="grid grid-cols-2 gap-3">
             <button 
               className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm"
               onClick={() => window.open(image.url, '_blank')}
             >
               <ExternalLink className="w-4 h-4" /> 打开
             </button>
             <button 
               className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm"
               onClick={() => navigator.clipboard.writeText(image.url)}
             >
               <Copy className="w-4 h-4" /> 复制
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [step, setStep] = useState<AppStep>('setup');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  
  // Data State
  const [images, setImages] = useState<ImageItem[]>([]);
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>([]);

  // Setup Handlers
  const handleStart = (loadedData: ImageItem[], definitions: TagDefinition[]) => {
    setImages(loadedData);
    setTagDefs(definitions);
    setStep('labeling');
  };

  const handleLoadDemo = () => {
    // Generate dummy items
    const demoItems = IMAGE_URLS.map((url, index) => {
       const parts = url.split('/');
       let filename = parts[parts.length - 1] || 'image';
       filename = filename.split('?')[0];
       return {
         id: `img-demo-${index}`,
         url,
         filename,
         tags: []
       }
    });
    setImages(demoItems);
    setTagDefs([
      { tag: "故宫景餐厅", title1: "餐饮", title2: "特色餐饮", content: "文华扒房提供优质牛排海鲜并俯瞰紫禁城，紫膳主理新派粤菜..." },
      { tag: "核心景点便捷", title1: "酒店位置", title2: "景点", content: "位于王府中环顶层，步行可达故宫、天安门广场及北京胡同..." },
      { tag: "主题水疗泳池", title1: "酒店设施", title2: "康养设施", content: "水疗中心设镜、花、水、月四间主题芳疗套房..." }
    ]);
    setStep('labeling');
  };

  const handleImportSession = (importedData: ImageItem[], restoredDefs: TagDefinition[]) => {
    setImages(importedData);
    setTagDefs(restoredDefs);
    setStep('labeling');
  };

  const handleReset = () => {
    if (confirm("确定要返回吗？所有未保存的进度都将丢失。")) {
      setStep('setup');
      setImages([]);
      setTagDefs([]);
      setSearchTerm('');
    }
  };

  // Tagging Logic
  const handleToggleTag = (imageId: string, tag: string) => {
    setImages(prev => prev.map(img => {
      if (img.id !== imageId) return img;
      const hasTag = img.tags.includes(tag);
      return {
        ...img,
        tags: hasTag ? img.tags.filter(t => t !== tag) : [...img.tags, tag]
      };
    }));
  };

  const handleExport = () => {
    // Transform to requested flattened format
    // Each tag on an image becomes a separate row. 
    // Unlabeled images are included with empty tag fields to preserve them in the dataset.
    // Strictly following schema: hotel_id, title1, title2, tag name, image_id, image_url
    
    const exportData: any[] = [];

    images.forEach(img => {
      // If image has no tags, add one entry with empty fields to keep track of it
      if (img.tags.length === 0) {
        exportData.push({
           "hotel_id": img.hotelId || "",
           "title1": "",
           "title2": "",
           "tag name": "",
           "image_id": img.originalImageId || img.id,
           "image_url": img.url
        });
      } else {
        // Create a row for each tag
        img.tags.forEach(tagStr => {
           const def = tagDefs.find(d => d.tag === tagStr);
           exportData.push({
              "hotel_id": img.hotelId || "",
              "title1": def?.title1 || "",
              "title2": def?.title2 || "",
              "tag name": tagStr,
              "image_id": img.originalImageId || img.id,
              "image_url": img.url
           });
        });
      }
    });

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    
    // Determine filename
    const firstItem = images.find(i => i.hotelId);
    const hotelId = firstItem?.hotelId || 'export';
    const hotelName = firstItem?.hotelName || '';
    const filename = `${hotelId}${hotelName ? '_' + hotelName : ''}.json`;

    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // Filter
  const filteredImages = useMemo(() => {
    if (!searchTerm) return images;
    const lowerTerm = searchTerm.toLowerCase();
    return images.filter(img => 
      img.filename.toLowerCase().includes(lowerTerm) || 
      img.url.toLowerCase().includes(lowerTerm) ||
      img.tags.some(t => t.toLowerCase().includes(lowerTerm)) ||
      (img.hotelId && String(img.hotelId).toLowerCase().includes(lowerTerm)) ||
      (img.originalImageId && String(img.originalImageId).toLowerCase().includes(lowerTerm))
    );
  }, [images, searchTerm]);

  // Pagination for grid
  const [displayLimit, setDisplayLimit] = useState(24);
  const visibleImages = filteredImages.slice(0, displayLimit);

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000 &&
        visibleImages.length < filteredImages.length
      ) {
        setDisplayLimit(prev => Math.min(prev + 24, filteredImages.length));
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleImages.length, filteredImages.length]);

  // Lightbox selection
  const selectedIndex = useMemo(() => 
    filteredImages.findIndex(img => img.id === selectedImageId)
  , [selectedImageId, filteredImages]);
  
  const selectedImage = selectedIndex !== -1 ? filteredImages[selectedIndex] : null;

  const handleNext = () => {
    if (selectedIndex < filteredImages.length - 1) {
      setSelectedImageId(filteredImages[selectedIndex + 1].id);
    }
  };

  const handlePrev = () => {
    if (selectedIndex > 0) {
      setSelectedImageId(filteredImages[selectedIndex - 1].id);
    }
  };

  if (step === 'setup') {
    return (
      <SetupScreen 
        onStart={handleStart} 
        onLoadDemo={handleLoadDemo} 
        onImportSession={handleImportSession}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Header 
        viewMode={viewMode} 
        setViewMode={setViewMode} 
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        totalCount={images.length}
        labeledCount={images.filter(i => i.tags.length > 0).length}
        onExport={handleExport}
        onReset={handleReset}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {filteredImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full mb-4">
              <Search className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">未找到图片</h3>
            <p className="text-slate-500 dark:text-slate-400">尝试调整搜索关键词</p>
          </div>
        ) : (
          <>
            {viewMode === 'grid' && (
              <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                {visibleImages.map((img) => (
                  <ImageCard 
                    key={img.id} 
                    image={img} 
                    onClick={() => setSelectedImageId(img.id)}
                  />
                ))}
              </div>
            )}
            
            {viewMode === 'list' && (
              <ListView 
                images={visibleImages} 
                onSelect={(img) => setSelectedImageId(img.id)}
              />
            )}

            {viewMode === 'summary' && (
              <SummaryView 
                images={filteredImages} 
                availableTags={tagDefs} 
                onSelect={(img) => setSelectedImageId(img.id)} 
              />
            )}

            {/* Loading Indicator for infinite scroll (only in grid/list) */}
            {viewMode !== 'summary' && visibleImages.length < filteredImages.length && (
              <div className="py-8 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Lightbox Modal */}
      {selectedImage && (
        <Lightbox 
          image={selectedImage} 
          availableTags={tagDefs}
          onToggleTag={(tag) => handleToggleTag(selectedImage.id, tag)}
          onClose={() => setSelectedImageId(null)} 
          onNext={handleNext}
          onPrev={handlePrev}
          hasNext={selectedIndex < filteredImages.length - 1}
          hasPrev={selectedIndex > 0}
          currentIndex={selectedIndex}
          totalCount={filteredImages.length}
        />
      )}
    </div>
  );
}