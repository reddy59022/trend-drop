import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => (isNative() ? Capacitor.getPlatform() : 'web');

/** Pick/take an image natively. Falls back to a file input on web. */
export const pickImage = async ({ source = CameraSource.Prompt } = {}) => {
  if (!isNative()) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result, file });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source,
      quality: 85,
    });
    return { dataUrl: photo.dataUrl, file: null };
  } catch (err) {
    if (err && err.message && err.message.includes('cancel')) return null;
    throw err;
  }
};

export const shareItem = async ({ title, text, url }) => {
  try {
    if (isNative()) {
      await Share.share({ title, text, url, dialogTitle: 'Share' });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    await navigator.clipboard.writeText(url || text || '');
    return true;
  } catch (err) {
    if (err && err.name !== 'AbortError') console.warn('Share failed:', err);
    return false;
  }
};

export const hapticTap = async () => {
  try {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* plugin not registered */ }
};

export const hapticSuccess = async () => {
  try {
    if (isNative()) await Haptics.notification({ type: 'SUCCESS' });
  } catch { /* plugin not registered */ }
};

export const setStatusBarColor = async (color, { light = false } = {}) => {
  try {
    if (isNative()) {
      await StatusBar.setBackgroundColor({ color });
      await StatusBar.setStyle({ style: light ? 'LIGHT' : 'DARK' });
    }
  } catch { /* plugin not registered */ }
};

export const getPlatformInfo = () => ({ platform: platform(), isNative: isNative() });