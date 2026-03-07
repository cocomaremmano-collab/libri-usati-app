import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { Camera, FolderPlus, Upload, Plus, X, Check, Image as ImageIcon, Trash2, Folder, ChevronRight, ArrowLeft, RefreshCw, HardDrive, Zap, Crop, Scissors } from 'lucide-react';
import { b2ListFiles, b2CreateFolder, b2UploadFile, b2DeleteFile, b2DeleteFolder } from './utils/b2';
import { processImage } from './utils/image';

interface Photo {
  id: string;
  dataUrl: string;
  type: 'front' | 'back' | 'extra';
}

interface Book {
  id: string;
  number: number;
  photos: Photo[];
  folderPath?: string;
  uploaded: boolean;
  uploading?: boolean;
}

interface StorageItem {
  id: string; // fileId or folder path
  name: string;
  fullName: string; // Full path
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  isFolder: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'capture' | 'archive'>('capture');
  
  // --- Capture State ---
  const [lotName, setLotName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSelect, setCustomerSelect] = useState<string>('NEW');
  const [lotSelect, setLotSelect] = useState<string>('NEW');
  const [customers, setCustomers] = useState<StorageItem[]>([]);
  const [lots, setLots] = useState<StorageItem[]>([]);
  const [isLoadingDropdowns, setIsLoadingDropdowns] = useState(false);
  const [nextBookNumber, setNextBookNumber] = useState(1);

  const [lotPath, setLotPath] = useState<string | null>(null);
  const [isCreatingLot, setIsCreatingLot] = useState(false);
  
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  
  const webcamRef = useRef<Webcam>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [photoType, setPhotoType] = useState<'front' | 'back' | 'extra'>('front');
  const [flash, setFlash] = useState(false);
  const [autoStraighten, setAutoStraighten] = useState(true); // Default to true as requested

  // --- Archive State ---


  const [archivePath, setArchivePath] = useState<{id: string, name: string}[]>([{id: 'root', name: 'Archivio'}]);
  const [archiveItems, setArchiveItems] = useState<StorageItem[]>([]);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [b2Error, setB2Error] = useState<string | null>(null);

  // --- Capture Logic ---
  const loadCustomers = async () => {
    setIsLoadingDropdowns(true);
    setB2Error(null);
    try {
      const folders = await b2ListFiles('');
      const customerFolders = folders.filter((d: any) => d.isFolder);
      setCustomers(customerFolders);
      if (customerFolders.length > 0 && customerSelect === 'NEW' && !customerName) {
        setCustomerSelect('');
      }
    } catch (e: any) {
      console.error(e);
      setB2Error(`Errore B2: ${e.message || JSON.stringify(e)}`);
    } finally {
      setIsLoadingDropdowns(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'capture' && !lotPath) {
      loadCustomers();
    }
  }, [activeTab, lotPath]);

  useEffect(() => {
    if (customerSelect && customerSelect !== 'NEW') {
      const customer = customers.find(c => c.name === customerSelect);
      if (customer) {
        const loadLots = async () => {
          setIsLoadingDropdowns(true);
          try {
            const items = await b2ListFiles(customer.fullName);
            const folders = items.filter((d: any) => d.isFolder);
            setLots(folders);
            if (folders.length > 0) setLotSelect('');
            else setLotSelect('NEW');
          } catch (e) {
            console.error(e);
          } finally {
            setIsLoadingDropdowns(false);
          }
        };
        loadLots();
      }
    } else {
      setLots([]);
      setLotSelect('NEW');
    }
  }, [customerSelect, customers]);

  const createLotFolder = async () => {
    const finalCustomerName = customerSelect === 'NEW' ? customerName : customerSelect;
    const finalLotName = lotSelect === 'NEW' ? lotName : lotSelect;

    if (!finalLotName || !finalCustomerName) {
      alert('Inserisci o seleziona Nome Lotto e Nome Cliente');
      return;
    }
    
    setIsCreatingLot(true);
    try {
      // Create Customer Folder
      const customerPath = `${finalCustomerName}/`;
      await b2CreateFolder(customerPath);
      
      // Create Lot Folder
      const lotPathStr = `${finalCustomerName}/${finalLotName}/`;
      await b2CreateFolder(lotPathStr);
      
      setLotPath(lotPathStr);

      // Fetch existing books
      const existingItems = await b2ListFiles(lotPathStr);
      const bookFolders = existingItems.filter((i: any) => i.isFolder && i.name.toLowerCase().startsWith('libro '));
      
      let maxNumber = 0;
      bookFolders.forEach((f: any) => {
        const match = f.name.match(/Libro\s+(\d+)/i);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) maxNumber = num;
        }
      });
      setNextBookNumber(maxNumber + 1);
      
    } catch (error: any) {
      console.error('Error creating lot folder', error);
      alert(`Errore creazione lotto: ${error.message}`);
    } finally {
      setIsCreatingLot(false);
    }
  };

  const resetLot = async () => {
    if (books.some(b => b.uploading)) {
      if (!confirm("Caricamenti in corso. Interrompere?")) return;
    } else {
      if (!confirm("Chiudere lotto e tornare alla selezione?")) return;
    }

    setLotPath(null);
    setLotName('');
    setCustomerName('');
    setCustomerSelect('NEW');
    setLotSelect('NEW');
    setBooks([]);
    setNextBookNumber(1);
    
    await loadCustomers();
  };

  const startNewBook = () => {
    const newBookNumber = nextBookNumber + books.length;
    setCurrentBook({
      id: Date.now().toString(),
      number: newBookNumber,
      photos: [],
      uploaded: false
    });
    setPhotoType('front');
    setCameraActive(true);
  };

  const triggerFlash = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  const capturePhoto = useCallback(async () => {
    if (webcamRef.current && currentBook) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        triggerFlash();
        
        const tempId = Date.now().toString();
        
        const newPhoto: Photo = {
          id: tempId,
          dataUrl: imageSrc,
          type: photoType
        };
        
        setCurrentBook(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            photos: [...prev.photos, newPhoto]
          };
        });
        
        // Auto-advance logic
        if (photoType === 'front') {
          setTimeout(() => setPhotoType('back'), 200);
        } else if (photoType === 'back') {
          setTimeout(() => setPhotoType('extra'), 200);
        }

        // If auto-straighten is on, we should process it in background and update the photo
        if (autoStraighten) {
          try {
            const blob = dataURLtoBlob(imageSrc);
            // Process with autoStraighten
            const processedBlob = await processImage(blob, autoStraighten);
            
            // Convert back to base64
            const reader = new FileReader();
            reader.onloadend = () => {
              const processedDataUrl = reader.result as string;
              
              setCurrentBook(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  photos: prev.photos.map(p => p.id === tempId ? { ...p, dataUrl: processedDataUrl } : p)
                };
              });
            };
            reader.readAsDataURL(processedBlob);
          } catch (e) {
            console.error("Image processing failed", e);
          }
        }
      }
    }
  }, [webcamRef, currentBook, photoType, autoStraighten]);

  const saveCurrentBook = () => {
    if (currentBook) {
      const bookToSave = { ...currentBook, uploading: true };
      setBooks(prev => [bookToSave, ...prev]); // Add to top
      setCurrentBook(null);
      setCameraActive(false);
      uploadBook(bookToSave);
    }
  };

  const cancelCurrentBook = () => {
    setCurrentBook(null);
    setCameraActive(false);
  };

  const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const uploadBook = async (book: Book) => {
    if (!lotPath) return;
    
    try {
      const bookFolderName = `Libro ${book.number}`;
      const bookFolderPath = `${lotPath}${bookFolderName}/`;
      
      await b2CreateFolder(bookFolderPath);

      for (let i = 0; i < book.photos.length; i++) {
        const photo = book.photos[i];
        const blob = dataURLtoBlob(photo.dataUrl);
        
        // Process image (resize + webp)
        const processedBlob = await processImage(blob);
        
        let fileName = `Libro_${book.number}_${photo.type}`;
        if (photo.type === 'extra') fileName += `_${i}`;
        fileName += '.webp';
        
        const fullFileName = `${bookFolderPath}${fileName}`;
        
        await b2UploadFile(processedBlob, fullFileName, 'image/webp');
      }

      setBooks(prev => prev.map(b => b.id === book.id ? { ...b, uploaded: true, uploading: false, folderPath: bookFolderPath } : b));
      
    } catch (error) {
      console.error('Error uploading book', error);
      alert(`Errore caricamento Libro ${book.number}`);
      setBooks(prev => prev.map(b => b.id === book.id ? { ...b, uploading: false } : b));
    }
  };

  // --- Archive Logic ---
  const fetchArchiveItems = async (prefix: string) => {
    setIsLoadingArchive(true);
    try {
      const items = await b2ListFiles(prefix === 'root' ? '' : prefix);
      setArchiveItems(items);
    } catch (error) {
      console.error(error);
      alert("Errore caricamento archivio");
    } finally {
      setIsLoadingArchive(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'archive') {
      fetchArchiveItems(archivePath[archivePath.length - 1].id);
    }
  }, [activeTab, archivePath]);

  const navigateToFolder = (folder: StorageItem) => {
    setArchivePath(prev => [...prev, { id: folder.fullName, name: folder.name }]);
  };

  const navigateUp = (index: number) => {
    setArchivePath(prev => prev.slice(0, index + 1));
  };

  const deleteDriveItem = async (item: StorageItem) => {
    if (item.isFolder) {
      if (!confirm(`ATTENZIONE: Stai per eliminare la cartella "${item.name}" e TUTTI i file al suo interno.\n\nQuesta azione NON può essere annullata.\n\nSei sicuro di voler procedere?`)) return;
      
      try {
        await b2DeleteFolder(item.fullName);
        fetchArchiveItems(archivePath[archivePath.length - 1].id);
      } catch (error) {
        console.error(error);
        alert("Errore eliminazione cartella");
      }
      return;
    }

    if (!confirm(`Eliminare "${item.name}"?`)) return;
    
    try {
      await b2DeleteFile(item.fullName, item.id);
      fetchArchiveItems(archivePath[archivePath.length - 1].id);
    } catch (error) {
      console.error(error);
      alert("Errore eliminazione");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans pb-20 md:pb-0">
      {/* Mobile-optimized Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10 safe-area-top">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-indigo-600" />
            <h1 className="font-semibold text-base tracking-tight">Book Cataloger</h1>
          </div>
          <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg">
            <button 
              onClick={() => setActiveTab('capture')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'capture' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}
            >
              Acquisisci
            </button>
            <button 
              onClick={() => setActiveTab('archive')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'archive' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}
            >
              Archivio
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 md:py-8">
        
        {b2Error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 flex items-start gap-3">
            <Zap className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Errore B2</p>
              <p className="text-sm">{b2Error}</p>
            </div>
          </div>
        )}

        {/* --- CAPTURE TAB --- */}
        {activeTab === 'capture' && (
          <div className="space-y-4 md:space-y-8">
            {/* Lot Configuration Card */}
            <section className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg font-semibold">Lotto Attivo</h2>
                {lotPath && (
                  <button 
                    onClick={resetLot}
                    className="text-xs text-indigo-600 font-medium flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-md"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Cambia
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1 uppercase tracking-wider">Cliente</label>
                  <select 
                    value={customerSelect}
                    onChange={e => setCustomerSelect(e.target.value)}
                    disabled={!!lotPath || isLoadingDropdowns}
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-zinc-50 disabled:text-zinc-400"
                  >
                    <option value="" disabled>-- Seleziona --</option>
                    {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    <option value="NEW">+ Nuovo Cliente</option>
                  </select>
                  
                  {customerSelect === 'NEW' && (
                    <input 
                      type="text" 
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      disabled={!!lotPath}
                      className="mt-2 w-full px-3 py-2.5 rounded-xl border border-zinc-300 text-sm focus:ring-2 focus:ring-indigo-500"
                      placeholder="Nome Cliente"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1 uppercase tracking-wider">Lotto</label>
                  <select 
                    value={lotSelect}
                    onChange={e => setLotSelect(e.target.value)}
                    disabled={!!lotPath || !customerSelect || isLoadingDropdowns}
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-zinc-50 disabled:text-zinc-400"
                  >
                    <option value="" disabled>-- Seleziona --</option>
                    {lots.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    <option value="NEW">+ Nuovo Lotto</option>
                  </select>
                  
                  {lotSelect === 'NEW' && (
                    <input 
                      type="text" 
                      value={lotName}
                      onChange={e => setLotName(e.target.value)}
                      disabled={!!lotPath || !customerSelect}
                      className="mt-2 w-full px-3 py-2.5 rounded-xl border border-zinc-300 text-sm focus:ring-2 focus:ring-indigo-500"
                      placeholder="Nome Lotto"
                    />
                  )}
                </div>
              </div>
              
              {!lotPath ? (
                <button 
                  onClick={createLotFolder}
                  disabled={isCreatingLot || (customerSelect === 'NEW' && !customerName) || (lotSelect === 'NEW' && !lotName) || !customerSelect || !lotSelect}
                  className="w-full md:w-auto flex justify-center items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  {isCreatingLot ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <FolderPlus className="w-4 h-4" />}
                  Crea e Inizia
                </button>
              ) : (
                <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-4 py-3 rounded-xl border border-emerald-100 text-sm">
                  <Check className="w-4 h-4" />
                  <span className="font-medium">Lotto attivo. Pronto per l'acquisizione.</span>
                </div>
              )}
            </section>

            {lotPath && !cameraActive && (
              <section className="pb-20">
                <div className="flex items-center justify-between mb-4 sticky top-14 bg-zinc-50 py-2 z-10">
                  <h2 className="text-lg font-semibold text-zinc-800">Libri ({books.length})</h2>
                </div>

                {/* Floating Action Button for Mobile / Standard Button for Desktop */}
                <button 
                  onClick={startNewBook}
                  className="fixed bottom-6 right-6 md:static md:w-full md:mb-6 z-30 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white w-14 h-14 md:h-12 md:rounded-xl rounded-full shadow-lg md:shadow-sm transition-all active:scale-90"
                >
                  <Camera className="w-6 h-6 md:w-5 md:h-5" />
                  <span className="hidden md:inline font-medium">Aggiungi Libro</span>
                </button>

                {books.length === 0 ? (
                  <div className="text-center py-12 px-4 bg-white rounded-2xl border border-zinc-200 border-dashed">
                    <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Camera className="w-8 h-8 text-zinc-300" />
                    </div>
                    <p className="text-zinc-500 text-sm">Tocca il pulsante fotocamera per iniziare.</p>
                  </div>
                ) : (
                  <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
                    {books.map(book => (
                      <div key={book.id} className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden flex flex-row md:flex-col h-24 md:h-auto">
                        {/* Status Strip */}
                        <div className={`w-1.5 md:w-full md:h-1.5 flex-shrink-0 ${book.uploading ? 'bg-blue-500 animate-pulse' : book.uploaded ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                        
                        <div className="flex-grow p-3 flex flex-col justify-between min-w-0">
                          <div className="flex justify-between items-start">
                            <h3 className="font-semibold text-zinc-900 truncate">Libro {book.number}</h3>
                            {book.uploading && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {book.photos.length} foto
                          </div>
                        </div>

                        {/* Thumbnail Preview */}
                        <div className="flex items-center gap-1 p-2 bg-zinc-50 border-l md:border-l-0 md:border-t border-zinc-100 w-32 md:w-full overflow-hidden">
                          {book.photos.slice(0, 3).map(photo => (
                            <img key={photo.id} src={photo.dataUrl} className="w-8 h-10 md:w-10 md:h-14 object-cover rounded border border-zinc-200 bg-white" alt="" />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Full Screen Camera Interface */}
            {cameraActive && currentBook && (
              <section className="fixed inset-0 z-50 bg-black flex flex-col safe-area-bottom">
                {/* Flash Overlay */}
                <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 z-50 ${flash ? 'opacity-80' : 'opacity-0'}`}></div>

                {/* Top Bar */}
                <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-20 bg-gradient-to-b from-black/60 to-transparent pt-safe-top">
                  <div>
                    <h2 className="text-white font-bold text-lg drop-shadow-md">Libro {currentBook.number}</h2>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${photoType === 'front' ? 'bg-indigo-600 text-white' : 'bg-black/40 text-white/60'}`}>FRONTE</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${photoType === 'back' ? 'bg-indigo-600 text-white' : 'bg-black/40 text-white/60'}`}>RETRO</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${photoType === 'extra' ? 'bg-indigo-600 text-white' : 'bg-black/40 text-white/60'}`}>EXTRA</span>
                    </div>
                  </div>
                  <button onClick={cancelCurrentBook} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-white/20 transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                {/* Camera Viewport */}
                <div className="flex-grow relative bg-zinc-900">
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{ 
                      facingMode: "environment",
                      // @ts-ignore
                      advanced: [{ focusMode: "continuous" }]
                    }}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  
                  {/* Guidelines */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[80%] h-[70%] border border-white/30 rounded-lg relative">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white"></div>
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white"></div>
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white"></div>
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white"></div>
                    </div>
                  </div>
                </div>
                
                {/* Bottom Controls */}
                <div className="bg-black p-6 pb-8 flex flex-col gap-6 items-center justify-end">
                  {/* Thumbnails Strip */}
                  {currentBook.photos.length > 0 && (
                    <div className="w-full flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                      {currentBook.photos.map((photo, idx) => (
                        <div key={photo.id} className="relative w-12 h-16 rounded overflow-hidden border border-zinc-700 flex-shrink-0">
                          <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="w-full flex justify-between items-center px-2">
                    {/* Auto-Straighten Toggle */}
                    <div className="w-32 flex justify-start gap-2">
                      <button 
                        onClick={() => setAutoStraighten(!autoStraighten)}
                        className={`flex flex-col items-center justify-center gap-1 font-medium text-xs active:scale-95 transition-transform ${autoStraighten ? 'text-indigo-400' : 'text-zinc-500'}`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg ${autoStraighten ? 'bg-indigo-600 text-white shadow-indigo-900/50' : 'bg-zinc-800 text-zinc-400'}`}>
                          <Crop className="w-5 h-5" />
                        </div>
                        <span>{autoStraighten ? 'AUTO' : 'OFF'}</span>
                      </button>
                    </div>

                    {/* Shutter Button */}
                    <button 
                      onClick={capturePhoto}
                      className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-white/10 active:bg-white active:scale-95 transition-all shadow-lg"
                    >
                      <div className="w-16 h-16 rounded-full bg-white"></div>
                    </button>

                    {/* Done Button */}
                    <div className="w-16 flex justify-end">
                      {currentBook.photos.length >= 2 && (
                        <button 
                          onClick={saveCurrentBook}
                          className="flex flex-col items-center justify-center gap-1 text-emerald-400 font-medium text-xs active:scale-95 transition-transform"
                        >
                          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-900/50">
                            <Check className="w-6 h-6" />
                          </div>
                          <span>FINE</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* --- ARCHIVE TAB --- */}
        {activeTab === 'archive' && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden min-h-[60vh]">
            {/* Breadcrumbs */}
            <div className="bg-zinc-50 border-b border-zinc-200 p-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
              {archivePath.map((folder, idx) => (
                <React.Fragment key={folder.id}>
                  <button 
                    onClick={() => navigateUp(idx)}
                    className={`whitespace-nowrap font-medium text-sm px-2 py-1 rounded-md ${idx === archivePath.length - 1 ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}
                  >
                    {folder.name}
                  </button>
                  {idx < archivePath.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-400 flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Content */}
            <div className="p-2 md:p-4">
              {isLoadingArchive ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : archiveItems.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 flex flex-col items-center">
                  <Folder className="w-12 h-12 text-zinc-200 mb-2" />
                  <p>Cartella vuota</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {archiveItems.map(item => {
                    return (
                      <div key={item.id} className="group relative border border-zinc-200 rounded-xl p-3 bg-white flex flex-col items-center text-center active:bg-zinc-50 transition-colors">
                        {item.isFolder ? (
                          <button onClick={() => navigateToFolder(item)} className="w-full flex flex-col items-center">
                            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mb-2">
                              <Folder className="w-6 h-6 text-indigo-500" />
                            </div>
                            <span className="font-medium text-xs text-zinc-800 line-clamp-2 leading-tight">{item.name}</span>
                          </button>
                        ) : (
                          <div className="w-full flex flex-col items-center">
                            <div className="w-full aspect-square bg-zinc-100 rounded-lg mb-2 overflow-hidden relative">
                              {item.thumbnailLink ? (
                                <img src={item.thumbnailLink} alt={item.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon className="w-8 h-8 text-zinc-300" />
                                </div>
                              )}
                              {item.webViewLink && (
                                <a href={item.webViewLink} target="_blank" rel="noreferrer" className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors">
                                  <span className="sr-only">Apri</span>
                                </a>
                              )}
                            </div>
                            <span className="font-medium text-[10px] text-zinc-500 line-clamp-1 w-full truncate">{item.name}</span>
                          </div>
                        )}
                        
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteDriveItem(item); }}
                          className="absolute top-1 right-1 p-1.5 bg-white/90 backdrop-blur rounded-full text-zinc-400 hover:text-red-600 shadow-sm border border-zinc-100"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      
      <style>{`
        .safe-area-top { padding-top: env(safe-area-inset-top); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom); }
        .pt-safe-top { padding-top: max(1rem, env(safe-area-inset-top)); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
