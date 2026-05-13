module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.rncustommap.RNCustomMapPackage;',
        packageInstance: 'new RNCustomMapPackage()',
      },
    },
  },
};
