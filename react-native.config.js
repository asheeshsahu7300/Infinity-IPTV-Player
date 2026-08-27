module.exports = {
  dependencies: {
    'react-native-mmkv': {
      platforms: {
        android: {
          packageImportPath: 'import com.margelo.nitro.mmkv.NitroMmkvPackage;',
          packageInstance: 'new NitroMmkvPackage()',
        },
      },
    },
  },
};
