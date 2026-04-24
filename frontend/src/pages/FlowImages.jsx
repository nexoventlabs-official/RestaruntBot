import { useState, useEffect, useRef } from 'react';
import { Upload, RefreshCw, Image as ImageIcon, Check, X, Loader2 } from 'lucide-react';
import api from '../api';

export default function FlowImages() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const fileInputRefs = useRef({});

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const res = await api.get('/flow-images');
      setImages(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load flow images');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (key, file) => {
    if (!file) return;
    setUploading(key);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.put(`/flow-images/${key}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImages(prev => prev.map(img => img.key === key ? res.data : img));
      setSuccess('Image uploaded successfully!' + (key === 'flow_welcome_banner' ? ' Flow is republishing in background...' : ''));
      setTimeout(() => setSuccess(null), 6000);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const handleReset = async (key) => {
    if (!confirm('Reset this image to default?')) return;
    setUploading(key);
    setError(null);
    try {
      const res = await api.post(`/flow-images/${key}/reset`);
      setImages(prev => prev.map(img => img.key === key ? res.data : img));
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed');
    } finally {
      setUploading(null);
    }
  };

  const isBanner = (key) => key.endsWith('_banner');

  // Separate into banners and service icons
  const bannerImages = images.filter(img => isBanner(img.key));
  const iconImages = images.filter(img => !isBanner(img.key));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  const ImageCard = ({ image, aspectClass, sizeLabel }) => (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      {/* Image Preview */}
      <div className={`relative ${aspectClass} bg-dark-100`}>
        {image.imageUrl ? (
          <img
            src={image.imageUrl}
            alt={image.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={`${image.imageUrl ? 'hidden' : 'flex'} absolute inset-0 items-center justify-center bg-dark-50`}
        >
          <div className="text-center text-dark-400">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No image uploaded</p>
            <p className="text-xs mt-1 text-dark-300">{sizeLabel}</p>
          </div>
        </div>
        {uploading === image.key && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        )}
        {image.cloudinaryPublicId && (
          <div className="absolute top-3 right-3 bg-green-500 text-white px-2 py-1 rounded-lg text-xs flex items-center gap-1">
            <Check className="w-3 h-3" />
            Custom
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-dark-900">{image.name}</h3>
        <p className="text-sm text-dark-500 mt-1">{image.description}</p>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={el => fileInputRefs.current[image.key] = el}
            onChange={(e) => {
              handleUpload(image.key, e.target.files[0]);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRefs.current[image.key]?.click()}
            disabled={uploading === image.key}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
          {image.cloudinaryPublicId && (
            <button
              onClick={() => handleReset(image.key)}
              disabled={uploading === image.key}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Flow Images</h1>
          <p className="text-dark-500 mt-1">Manage WhatsApp Flow images (banner &amp; service icons)</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <X className="w-5 h-5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <Check className="w-5 h-5" />
          {success}
          <button onClick={() => setSuccess(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Banner Section */}
      {bannerImages.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-dark-800 mb-3">Flow Banners</h2>
          <p className="text-sm text-dark-400 mb-4">Banner images displayed at the top of flow screens. Recommended: 1000 × 125px (8:1 ratio). Auto-resized to fit.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {bannerImages.map(img => (
              <ImageCard key={img.key} image={img} aspectClass="aspect-[8/1]" sizeLabel="1000 × 125px (8:1)" />
            ))}
          </div>
        </div>
      )}

      {/* Service Icons Section */}
      {iconImages.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-dark-800 mb-3">Service Icons</h2>
          <p className="text-sm text-dark-400 mb-4">Square icons for each service in the welcome flow dropdown. Recommended: 600 × 600px (1:1 ratio)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {iconImages.map(img => (
              <ImageCard key={img.key} image={img} aspectClass="aspect-square" sizeLabel="600 × 600px (1:1)" />
            ))}
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <ImageIcon className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h4 className="font-medium text-blue-900">Flow Image Guidelines</h4>
            <ul className="text-sm text-blue-700 mt-2 space-y-1">
              <li>• <strong>Banners:</strong> 1000 × 125px (8:1 landscape) — auto-cropped on upload</li>
              <li>• <strong>Service Icons:</strong> 600 × 600px (1:1 square) — auto-cropped on upload</li>
              <li>• Supported formats: JPG, PNG, WebP</li>
              <li>• Max file size: 10MB</li>
              <li>• Images are optimized via Cloudinary for fast delivery</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
