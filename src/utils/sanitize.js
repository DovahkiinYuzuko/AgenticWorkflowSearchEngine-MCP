const sanitizeFolderName = (folderName) => {
    return folderName.replace(/[\\/:*?"<>|]/g, '');
};

module.exports = sanitizeFolderName;
