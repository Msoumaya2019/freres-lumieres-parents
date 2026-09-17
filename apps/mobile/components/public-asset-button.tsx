import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { publicAssetUrl } from '../services/public-content';
import { Button } from './ui';

export function PublicAssetButton({
  path,
  label,
}: {
  path?: string;
  label: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (!path) return null;
  const assetPath = path;
  async function open() {
    setLoading(true);
    setError('');
    try {
      await Linking.openURL(await publicAssetUrl(assetPath));
    } catch {
      setError('Document momentanément indisponible.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button
        label={label}
        loading={loading}
        onPress={() => void open()}
        secondary
      />
      {error ? <Text accessibilityLiveRegion="polite">{error}</Text> : null}
    </>
  );
}
