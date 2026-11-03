export const checkEnvironmentVariables = () => {
  const requiredVariables = {
    'VITE_CLOUDINARY_CLOUD_NAME': import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
    'VITE_CLOUDINARY_UPLOAD_PRESET': import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
  };

  console.log('API Keys Status:');
  let missingKeys = false;
  Object.entries(requiredVariables).forEach(([key, value]) => {
    if (!value) {
      console.error(`❌ ${key} is not configured`);
      missingKeys = true;
    } else {
      console.log(`✅ ${key} is configured`);
    }
  });

  if (missingKeys) {
    console.error('Please add the missing API keys to your .env file. Required keys:');
    Object.keys(requiredVariables).forEach(key => {
      console.error(`- ${key}`);
    });
  }

  return !missingKeys;
};
