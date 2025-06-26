/**
 * Project: Minerva KB
 * Copyright: 2015-2016 @KonstruktStudio
 */
(function($) {
    'use strict';

    var GLOBAL_DATA = window.MinervaKB || {}; // TODO: broken in admin
    var settings = GLOBAL_DATA.settings || {};
    // var ajaxUrl = GLOBAL_DATA.ajaxUrl;
    // var i18n = GLOBAL_DATA.i18n;

    // polyfills
    // https://tc39.github.io/ecma262/#sec-array.prototype.includes
    if (!Array.prototype.includes) {
        Object.defineProperty(Array.prototype, 'includes', {
            value: function(searchElement, fromIndex) {

                if (this == null) {
                    throw new TypeError('"this" is null or not defined');
                }

                // 1. Let O be ? ToObject(this value).
                var o = Object(this);

                // 2. Let len be ? ToLength(? Get(O, "length")).
                var len = o.length >>> 0;

                // 3. If len is 0, return false.
                if (len === 0) {
                    return false;
                }

                // 4. Let n be ? ToInteger(fromIndex).
                //    (If fromIndex is undefined, this step produces the value 0.)
                var n = fromIndex | 0;

                // 5. If n ≥ 0, then
                //  a. Let k be n.
                // 6. Else n < 0,
                //  a. Let k be len + n.
                //  b. If k < 0, let k be 0.
                var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

                function sameValueZero(x, y) {
                    return x === y || (typeof x === 'number' && typeof y === 'number' && isNaN(x) && isNaN(y));
                }

                // 7. Repeat, while k < len
                while (k < len) {
                    // a. Let elementK be the result of ? Get(O, ! ToString(k)).
                    // b. If SameValueZero(searchElement, elementK) is true, return true.
                    if (sameValueZero(o[k], searchElement)) {
                        return true;
                    }
                    // c. Increase k by 1.
                    k++;
                }

                // 8. Return false
                return false;
            }
        });
    }

    /**
     * General utils
     */

    function makeArray(thing) {
        if (!thing) {
            return [];
        }

        return [].slice.apply(thing);
    }

    function getElementIndex(node) {
        var index = 0;

        while ((node = node.previousElementSibling)) {
            index++;
        }

        return index;
    }

    function humanFileSize(bytes, si) {
        var thresh = si ? 1000 : 1024;

        if (Math.abs(bytes) < thresh) {
            return bytes + 'B';
        }

        var units = si
            ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
            : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
        var u = -1;

        do {
            bytes /= thresh;
            ++u;
        } while(Math.abs(bytes) >= thresh && u < units.length - 1);

        return bytes.toFixed(1) + '' + units[u];
    }

    /**
     * Quill editor with optional file uploader
     * @param options
     */
    function setupQuillEditor(options) {
        var $form = options.$form;
        var isStandaloneUploadButton = settings['tickets_create_use_standalone_upload_button'];

        var toolbarOptions = options.toolbarOptions || [
            [{'header': [1, 2, 3, 4, 5, 6, false]}],
            ['bold', 'italic', 'underline', 'strike'],
            [{'list': 'ordered'}, {'list': 'bullet'}],
            ['link'],
            ['blockquote', 'code-block'],
            ['clean']
        ];

        if (options.fileUpload && !isStandaloneUploadButton) {
            toolbarOptions.push(['upload']);
        }

        var quillEditor = new Quill(options.editorSelector, {
            modules: {
                toolbar: toolbarOptions,
                history: {
                    delay: 2000,
                    maxStack: 500,
                    userOnly: true
                }
            },
            placeholder: options.placeholder || 'Write your message here...', // TODO: TK
            theme: options.theme || 'snow' // TODO: fix
        });

        // remove formatting on paste, leave only strings
        quillEditor.clipboard.addMatcher(Node.ELEMENT_NODE, function (node, delta) {
            var ops = [];

            delta.ops.forEach(function(op) {
                var urlRegex = /https?:\/\/[^\s]+/g;

                if (op.insert && typeof op.insert === 'string') {
                    if (op.attributes && op.attributes.link) {
                        // preserve links. TODO: maybe add safe attributes
                        ops.push({ insert: op.insert.trim(), attributes: { link: op.attributes.link } });
                    } else {
                        ops.push({ insert: op.insert });
                    }
                }
            });

            delta.ops = ops;

            return delta;
        });

        if (!options.fileUpload) {
            return quillEditor;
        }

        var isAttachmentsOpen = false;
        var uploadButton = isStandaloneUploadButton ? $form.find('.js-mkb-ticket-attach-files')[0] : $form.find('.ql-upload')[0];
        var $attachmentsSection = $form.find('.js-mkb-editor-attachments-section');

        /**
         * Attachments
         */
        uploadButton.addEventListener('click', function(e) {
            e.preventDefault();

            if (!isStandaloneUploadButton) {
                uploadButton.classList.toggle('state--on');
            }

            $attachmentsSection[isAttachmentsOpen ? 'slideUp' : 'slideDown'](250);
            isAttachmentsOpen = !isAttachmentsOpen;
        });

        setupFileUpload({
            $dropArea: $form.find('.js-mkb-editor-attachments-drop-area'),
            $form: $form
        });

        return quillEditor;
    }

    /**
     * File uploader
     */
    function setupFileUpload(options) {
        var $dropArea = options.$dropArea;
        var $form = options.$form;

        if (!$dropArea || !$dropArea.length || !$form || !$form.length) {
            console.log('Could not initialize file uploader');

            return;
        }

        var dropArea = $dropArea.get(0);

        var $preview = $dropArea.find('.js-mkb-file-upload-preview');
        var $clearFiles = $dropArea.find('.js-mkb-file-upload-clear');
        var $uploadBtn = $dropArea.find(".js-mkb-file-upload-store");
        var $fileStore = $uploadBtn; // alias
        var $dropErrors = $dropArea.find('.js-mkb-file-upload-drop-errors');

        // control options
        var allowedTypes = $fileStore.attr('accept') || '';
        var maxFiles = $fileStore.data('maxFiles');
        var maxFileSizeInMb = $fileStore.data('maxFileSize');

        $form.attr('enctype', 'multipart/form-data');

        allowedTypes = allowedTypes.split(',').map(function(type) {
            return type.trim().replace('.', '');
        });

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
            /**
             * NOTE: Can affect other plugins on page, watch this closely
             * Needed to avoid opening of dropped file in browser.
             * Must be on body or wider container, otherwise browser will show drop icon outside drop area
             */
            document.body.addEventListener(eventName, function preventDefaults(e) {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Highlight drop area when item is dragged over it
        ['dragenter', 'dragover'].forEach(function(eventName) {
            dropArea.addEventListener(eventName, function highlight() {
                $dropArea.addClass('mkb-drop-highlight');
            }, false);
        });

        ['dragleave', 'drop'].forEach(function(eventName) {
            dropArea.addEventListener(eventName, function unhighlight() {
                $dropArea.removeClass('mkb-drop-highlight');
            }, false);
        });

        // Handle dropped files
        dropArea.addEventListener('drop', function(e) {
            handleAddedFiles(e.dataTransfer.files, true);
        } , false);

        // upload btn click
        $uploadBtn.get(0).addEventListener('change', function() {
            handleAddedFiles(this.files);
        }, false);

        function createDataTransferObject() {
            return new ClipboardEvent('').clipboardData || new DataTransfer();
        }

        // errors state
        var hasNotAllowedFilesError = false;
        var hasTooLargeFilesError = false;
        var hasTooManyFiles = false;
        var fileAlreadyAddedError = false;

        function handleAddedFiles(addedFiles, isDragAndDrop) {
            isDragAndDrop = isDragAndDrop || false;

            // TODO: merge all files, check across browsers
            var oldFilesArr = isDragAndDrop ? makeArray($fileStore.prop('files')) : [];
            var newFilesArray = makeArray(addedFiles);
            var oldFileNames = oldFilesArr.map(function(item) { return item.name; });

            // reset errors state
            hasNotAllowedFilesError = false;
            hasTooLargeFilesError = false;
            hasTooManyFiles = false;
            fileAlreadyAddedError = false;

            if (oldFilesArr.length >= maxFiles) {
                hasTooManyFiles = true;

                handleAddFileErrors();

                return;
            }

            console.log('adding files', newFilesArray);

            newFilesArray = newFilesArray.filter(function(item) {
                var extension = item.name.split('.').pop().toLowerCase();
                var isAllowed = allowedTypes.includes(extension);
                var isValidSize = item.size / (1024 * 1024) <= maxFileSizeInMb;
                var isAlreadyAdded = oldFileNames.includes(item.name);

                if (!isAllowed) {
                    hasNotAllowedFilesError = true;
                }

                if (!isValidSize) {
                    hasTooLargeFilesError = true;
                }

                if (isAlreadyAdded) {
                    fileAlreadyAddedError = true;
                }

                return isAllowed && isValidSize && !isAlreadyAdded;
            });

            var allFilesArr = oldFilesArr.concat(newFilesArray);

            if (allFilesArr.length > maxFiles) {
                hasTooManyFiles = true;

                allFilesArr = allFilesArr.slice(0, maxFiles);
            }

            var allFiles = createDataTransferObject();

            allFilesArr.forEach(function(file) {
                allFiles.items.add(file);
            });

            if (allFiles.files.length) {
                $fileStore.prop('files', allFiles.files);
            } else {
                clearFiles();
            }

            handleAddFileErrors();
            updatePreview(allFiles.files);

            console.log('[DEBUG]: Files in storage', $fileStore.prop('files'));
        }

        /**
         * Process and display file add errors
         */
        function handleAddFileErrors() {
            clearErrors();

            var addFileErrors = [];

            if (hasNotAllowedFilesError) {
                // TODO: translations
                addFileErrors.push('Some of the added files are not allowed');
            }

            if (hasTooLargeFilesError) {
                // TODO: translations
                addFileErrors.push('Some of the added files are too large');
            }

            if (hasTooManyFiles) {
                // TODO: translations
                addFileErrors.push('Maximum file limit is reached, some files were not added');
            }

            if (fileAlreadyAddedError) {
                // TODO: translations
                addFileErrors.push('Some of the files are already added');
            }

            if (addFileErrors.length) {
                $dropErrors.html(
                    addFileErrors.reduce(function(html, error) {
                        return html + '<div>' + error + '</div>'
                    }, '')
                );

                // TODO: clear errors somehow, or highlight when they change but look the same
            }
        }

        function clearErrors() {
            $dropErrors.html('');
        }

        /**
         * Preview update
         * @param files
         */
        function updatePreview(files) {
            $preview.html('');

            // not an array usually
            files = makeArray(files);

            files.forEach(function addFilePreview(file) {
                var isImage = /^image\//.test(file.type);
                var $item = $(
                    '<div class="js-mkb-attachment-upload-preview-item mkb-attachment-upload-preview-item">' +
                        '<a href="#" class="js-mkb-attachment-preview-remove mkb-attachment-preview-remove fa fa-times-circle"></a>' +
                    '</div>'
                );

                if (isImage) {
                    var reader = new FileReader();
                    reader.readAsDataURL(file);

                    reader.onloadend = function() {
                        var img = document.createElement('img');
                        img.src = reader.result;
                        $item.append(img);
                    };

                    $item.addClass('type--image');
                } else {
                    // non-image files
                    $item.append('<span>' + file.name + ' (' + humanFileSize(file.size, true) + ')' + '</span>');
                    $item.addClass('type--file');
                }

                $preview.append($item);
            });
        }

        /**
         * Remove file by icon click
         */
        $preview.on('click', '.js-mkb-attachment-preview-remove', function(e) {
            e.preventDefault();

            var indexToRemove = getElementIndex(e.currentTarget.parentNode);
            var currentFilesArray = makeArray($fileStore.prop('files'));
            var updatedFiles = createDataTransferObject();

            currentFilesArray.filter(function(file, index) {
                return index !== indexToRemove;
            }).forEach(function(file, index) {
                updatedFiles.items.add(file);
            });

            if (updatedFiles.files.length) {
                $fileStore.prop('files', updatedFiles.files);
                updatePreview(updatedFiles.files);

                console.log('[DEBUG]: Files in storage', $fileStore.prop('files'));
            } else {
                clearFiles();
            }

            clearErrors();
        });

        function clearFiles() {
            $fileStore.val(null); // if causes issues across browser, replace with clone
            updatePreview([]);

            console.log('[DEBUG]: Files in storage', $fileStore.prop('files'));
        }

        $clearFiles.on('click', function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();

            clearFiles();
            clearErrors();
        });
    }

    /**
     *
     * @param el
     * @param options
     * @constructor
     */
    function Form(el, options) {
        options = options || {};

        // state
        this._isLoading = false;

        // options
        this.options = options;

        // controls data
        this.controls = {};
        this.quillEditors = this.options.quillEditors || [];

        // DOM
        this.el = el;
        this.$el = $(el);
        this.$messagesEl = this.$el.find('.js-mkb-form-messages');
        this.$submit = this.$el.find('.js-mkb-form-submit');

        // labels
        this.submitLabel = this.$submit.val();
        this.submitLoadingLabel = this.$submit.data('progress-label');

        // setup
        this.findControls();
    }

    Form.prototype.findControls = function() {
        var $controls = this.$el.find('input:not(.js-mkb-form-submit), select, textarea');

        this.controls = makeArray($controls).map(function(el) {
            return {
                id: el.getAttribute('name'),
                el: el,
                $el: $(el)
            };
        });
    };

    Form.prototype.isLoading = function() {
        return this._isLoading;
    };

    Form.prototype.startLoading = function() {
        this._isLoading = true;

        this.disableControls();
        this.disableControl(this.$submit);
        this.$submit.val(this.submitLoadingLabel);
        this.$el.addClass('state--loading');

        this.$el.append('<div class="js-mkb-form-overlay mkb-form-overlay"></div>')
    };

    Form.prototype.endLoading = function() {
        this._isLoading = false;

        this.enableControls();
        this.enableControl(this.$submit);
        this.$submit.val(this.submitLabel);

        this.$el.find('.js-mkb-form-overlay').remove();
        this.$el.removeClass('state--loading');
    };

    Form.prototype.disableControls = function() {
        this.controls.forEach(function(control) {
            this.disableControl(control.$el);
        }.bind(this));

        this.quillEditors.forEach(function(quillEditor) {
            quillEditor.enable(false);
        });
    };

    Form.prototype.lock = function() {
        // TODO: maybe use separate state var
        this._isLoading = true;

        this.disableControls();
        this.disableControl(this.$submit);
    };

    Form.prototype.enableControls = function() {
        this.controls.forEach(function(control) {
            this.enableControl(control.$el);
        }.bind(this));

        this.quillEditors.forEach(function(quillEditor) {
            quillEditor.enable(true);
        });
    };

    Form.prototype.disableControl = function($control) {
        $control.attr('disabled', 'disabled');
    };

    Form.prototype.enableControl = function($control) {
        $control.attr('disabled', false);
    };

    Form.prototype.showMessages = function(messages, messagesType) {
        messagesType = messagesType || 'error';

        this.clearMessages();

        this.$messagesEl
            .addClass('mkb-form-messages--' + messagesType)
            .html(messages); // TODO: handle array

        $([document.documentElement, document.body]).animate({
            scrollTop: this.$messagesEl.offset().top - parseInt(settings['global_scroll_offset']['size'], 10) // TODO: scroll offset setting
        }, 100);
    };

    Form.prototype.clearMessages = function() {
        this.$messagesEl.removeClass('mkb-form-messages--error mkb-form-messages--success').html('')
    };

    Form.prototype.serialize = function() {
        return $(this.el).serializeArray().reduce(function(store, kv) {
            store[kv.name] = kv.value;
            return store;
        }, {});
    };

    /**
     * Exports
     */
    window.MinervaCommonUI = {
        Form: Form,
        setupQuillEditor: setupQuillEditor,
        setupFileUpload: setupFileUpload
    };
})(window.jQuery);