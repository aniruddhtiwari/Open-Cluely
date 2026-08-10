document.addEventListener('DOMContentLoaded', () => {    
    const logger = {
        info: (...args) => console.log('[SettingsWindowUI]', ...args)
    };

    // Get DOM elements
    const closeButton = document.getElementById('closeButton');
    const quitButton = document.getElementById('quitButton');
    const speechProviderSelect = document.getElementById('speechProvider');
    const respondToSelect = document.getElementById('respondTo');
    const azureKeyInput = document.getElementById('azureKey');
    const azureRegionInput = document.getElementById('azureRegion');
    const whisperCommandInput = document.getElementById('whisperCommand');
    const whisperModelInput = document.getElementById('whisperModel');
    const whisperLanguageInput = document.getElementById('whisperLanguage');
    const whisperDeviceSelect = document.getElementById('whisperDevice');
    const whisperCaptureModeSelect = document.getElementById('whisperCaptureMode');
    const whisperResponseTargetSelect = document.getElementById('whisperResponseTarget');
    const whisperSegmentMsInput = document.getElementById('whisperSegmentMs');
    const geminiKeyInput = document.getElementById('geminiKey');
    const windowGapInput = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
	const activeSkillSelect = document.getElementById('activeSkill');
	const customSkillRow = document.getElementById('customSkillRow');
	const customSkillInput = document.getElementById('customSkill');
	const activeProfileSelect = document.getElementById('activeProfile');
	const iconGrid = document.getElementById('iconGrid');
    const windowOpacityInput = document.getElementById('windowOpacity');
    const windowOpacityValue = document.getElementById('windowOpacityValue');
    const responseFontSizeInput = document.getElementById('responseFontSize');
    const responseFontSizeValue = document.getElementById('responseFontSizeValue');
    const responseTextColorInput = document.getElementById('responseTextColor');
    const responseBackgroundColorInput = document.getElementById('responseBackgroundColor');
    const resetAppearanceButton = document.getElementById('resetAppearance');

    // Check if window.api exists
    if (!window.api) {
        console.error('window.api not available');
        return;
    }

    // Request current settings when window opens
    const requestCurrentSettings = async () => {
        if (!window.electronAPI || !window.electronAPI.getSettings) return;

        let settings;
        try {
            settings = await window.electronAPI.getSettings();
            loadSettingsIntoUI(settings);
        } catch (error) {
            console.error('Failed to get settings:', error);
            return;
        }

        try {
            if (!window.electronAPI.getAvailablePromptOptions) {
                throw new Error('getAvailablePromptOptions API is not available');
            }

            const options = await window.electronAPI.getAvailablePromptOptions();
            populateSkillSelect(
                activeSkillSelect,
                options.skills,
                settings.activeSkill,
                'No skills found'
            );
            populatePromptSelect(
                activeProfileSelect,
                options.profiles,
                settings.activeProfile,
                'No profiles found'
            );
        } catch (error) {
            console.error('Failed to load dynamic prompt options:', error);
            populateSkillSelect(activeSkillSelect, [], settings.activeSkill, 'No skills found');
            populatePromptSelect(activeProfileSelect, [], '', 'No profiles found');
        }
    };

    const populatePromptSelect = (select, items, savedValue, emptyLabel) => {
        if (!select) return;

        select.replaceChildren();
        select.appendChild(new Option('None', ''));

        if (!Array.isArray(items) || items.length === 0) {
            const option = new Option(emptyLabel, '__unavailable');
            option.disabled = true;
            select.appendChild(option);
            select.value = '';
            return;
        }

        items.forEach(item => {
            select.appendChild(new Option(item.name, item.id));
        });

        const availableIds = new Set(items.map(item => item.id));
        if (typeof savedValue === 'string' && savedValue && availableIds.has(savedValue)) {
            select.value = savedValue;
        } else {
            select.value = '';
        }
    };

    // Close button handler
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            window.api.send('close-settings');
        });
    }

    // Quit button handler with multiple attempts
    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                // Try multiple ways to quit the app
                if (window.api && window.api.send) {
                    window.api.send('quit-app');
                }
                
                // Also try the electron API if available
                if (window.electronAPI && window.electronAPI.quit) {
                    window.electronAPI.quit();
                }
                
                // Fallback: close the window
                setTimeout(() => {
                    window.close();
                }, 500);
                
            } catch (error) {
                console.error('Error quitting app:', error);
                window.close();
            }
        });
    }

    // Function to load settings into UI
    const loadSettingsIntoUI = (settings) => {
        if (settings.speechProvider && speechProviderSelect) speechProviderSelect.value = settings.speechProvider;
        if (respondToSelect) respondToSelect.value = 'all';
        // Always set the input value, even if empty, so the user sees what's
        // currently configured (including env-derived defaults). Previously
        // empty strings were skipped which left stale UI values.
        if (azureKeyInput) azureKeyInput.value = settings.azureKey || '';
        if (azureRegionInput) azureRegionInput.value = settings.azureRegion || '';
        if (whisperCommandInput) whisperCommandInput.value = settings.whisperCommand || '';
        if (whisperModelInput) whisperModelInput.value = settings.whisperModel || '';
        if (whisperLanguageInput) whisperLanguageInput.value = settings.whisperLanguage || '';
        if (whisperDeviceSelect) whisperDeviceSelect.value = settings.whisperDevice || 'auto';
        if (whisperCaptureModeSelect) whisperCaptureModeSelect.value = settings.whisperCaptureMode || 'vad';
        if (whisperResponseTargetSelect) whisperResponseTargetSelect.value = settings.whisperResponseTarget || 'both';
        if (whisperSegmentMsInput) whisperSegmentMsInput.value = settings.whisperSegmentMs || '';
        if (geminiKeyInput) geminiKeyInput.value = settings.geminiKey || '';
        if (windowGapInput) windowGapInput.value = settings.windowGap || '';
        if (windowOpacityInput) windowOpacityInput.value = String(Math.round((settings.windowOpacity || 1) * 100));
        if (windowOpacityValue) windowOpacityValue.textContent = `${windowOpacityInput.value}%`;
        if (responseFontSizeInput) responseFontSizeInput.value = String(settings.responseFontSize || 14);
        if (responseFontSizeValue) responseFontSizeValue.textContent = `${responseFontSizeInput.value}px`;
        if (responseTextColorInput) responseTextColorInput.value = settings.responseTextColor || '#ffffff';
        if (responseBackgroundColorInput) responseBackgroundColorInput.value = settings.responseBackgroundColor || '#111827';

        if (codingLanguageSelect) {
            codingLanguageSelect.value = settings.codingLanguage || '';
        }

        if (activeSkillSelect) activeSkillSelect.value = settings.activeSkill || '';
        if (customSkillInput) customSkillInput.value = settings.customSkill || '';
        updateCustomSkillVisibility();

		if (activeProfileSelect) activeProfileSelect.value = settings.activeProfile || '';

        // Handle icon selection
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            const iconOptions = iconGrid.querySelectorAll('.icon-option');
            iconOptions.forEach(option => {
                if (option.dataset.icon === selectedIcon) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });
        }

        updateSpeechFieldStates();
    };

    // Load settings when window opens
    window.api.receive('load-settings', (settings) => {
        loadSettingsIntoUI(settings);
    });

    // Listen for settings window shown event
    if (window.electronAPI && window.electronAPI.receive) {
        window.electronAPI.receive('settings-window-shown', () => {
            requestCurrentSettings();
        });

    // Listen for coding language changes from other windows via helper
    window.electronAPI.onCodingLanguageChanged((event, data) => {
            if (data && Object.prototype.hasOwnProperty.call(data, 'language') && codingLanguageSelect) {
                codingLanguageSelect.value = data.language || '';
                console.log('Language updated from overlay window:', data.language);
            }
    });
        window.electronAPI.receive('skill-updated', (_event, data) => {
            if (activeSkillSelect && data && Object.prototype.hasOwnProperty.call(data, 'skill')) {
                activeSkillSelect.value = data.skill || '';
                updateCustomSkillVisibility();
            }
        });
        window.electronAPI.receive('custom-skill-changed', (_event, data) => {
            if (customSkillInput && data && Object.prototype.hasOwnProperty.call(data, 'customSkill')) {
                customSkillInput.value = data.customSkill || '';
            }
        });
        window.electronAPI.receive('profile-updated', (_event, data) => {
            if (activeProfileSelect && data && Object.prototype.hasOwnProperty.call(data, 'profile')) {
                activeProfileSelect.value = data.profile || '';
            }
        });
        window.electronAPI.onAppearanceChanged((_event, appearance) => {
            if (!appearance) return;
            if (windowOpacityInput) windowOpacityInput.value = String(Math.round(appearance.windowOpacity * 100));
            if (windowOpacityValue) windowOpacityValue.textContent = `${windowOpacityInput.value}%`;
            if (responseFontSizeInput) responseFontSizeInput.value = String(appearance.responseFontSize);
            if (responseFontSizeValue) responseFontSizeValue.textContent = `${responseFontSizeInput.value}px`;
            if (responseTextColorInput) responseTextColorInput.value = appearance.responseTextColor;
            if (responseBackgroundColorInput) responseBackgroundColorInput.value = appearance.responseBackgroundColor;
        });
        window.electronAPI.receive('respond-to-changed', (_event, data) => {
            if (respondToSelect && data) {
                respondToSelect.value = 'all';
            }
        });
    }

    // Save settings helper function
    const saveSettings = () => {
        const settings = {};
        if (speechProviderSelect) settings.speechProvider = speechProviderSelect.value;
        if (respondToSelect) settings.respondTo = respondToSelect.value;
        if (azureKeyInput) settings.azureKey = azureKeyInput.value;
        if (azureRegionInput) settings.azureRegion = azureRegionInput.value;
        if (whisperCommandInput) settings.whisperCommand = whisperCommandInput.value;
        if (whisperModelInput) settings.whisperModel = whisperModelInput.value;
        if (whisperLanguageInput) settings.whisperLanguage = whisperLanguageInput.value;
        if (whisperDeviceSelect) settings.whisperDevice = whisperDeviceSelect.value;
        if (whisperCaptureModeSelect) settings.whisperCaptureMode = whisperCaptureModeSelect.value;
        if (whisperResponseTargetSelect) settings.whisperResponseTarget = whisperResponseTargetSelect.value;
        if (whisperSegmentMsInput) settings.whisperSegmentMs = whisperSegmentMsInput.value;
        if (geminiKeyInput) settings.geminiKey = geminiKeyInput.value;
        if (windowGapInput) settings.windowGap = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (activeSkillSelect) settings.activeSkill = activeSkillSelect.value;
        if (customSkillInput) settings.customSkill = customSkillInput.value;
        if (activeProfileSelect) settings.activeProfile = activeProfileSelect.value;
        if (windowOpacityInput) settings.windowOpacity = Number(windowOpacityInput.value) / 100;
        if (responseFontSizeInput) settings.responseFontSize = Number(responseFontSizeInput.value);
        if (responseTextColorInput) settings.responseTextColor = responseTextColorInput.value;
        if (responseBackgroundColorInput) settings.responseBackgroundColor = responseBackgroundColorInput.value;
        window.api.send('save-settings', settings);
    };

    const updateSpeechFieldStates = () => {
        const provider = speechProviderSelect ? speechProviderSelect.value : 'azure';

        // Show/hide provider-specific field groups instead of just disabling
        // them. This keeps the settings UI clean — only the relevant fields
        // for the selected provider are visible.
        const azureGroup = document.getElementById('azureFields');
        const whisperGroup = document.getElementById('whisperFields');
        const azureNote = document.getElementById('azureFieldsNote');

        if (azureGroup) {
            azureGroup.style.display = provider === 'azure' ? '' : 'none';
        }
        if (whisperGroup) {
            whisperGroup.style.display = provider === 'whisper' ? '' : 'none';
        }
        if (azureNote) {
            azureNote.style.display = provider === 'azure' ? '' : 'none';
        }

        // Also toggle disabled attribute for any leftover direct field refs
        [azureKeyInput, azureRegionInput].forEach(input => {
            if (input) input.disabled = provider !== 'azure';
        });
        [whisperCommandInput, whisperModelInput, whisperLanguageInput, whisperDeviceSelect,
            whisperCaptureModeSelect, whisperResponseTargetSelect, whisperSegmentMsInput].forEach(input => {
            if (input) input.disabled = provider !== 'whisper';
        });
    };

    // Add event listeners for all inputs
    const inputs = [
        respondToSelect,
        customSkillInput,
        azureKeyInput,
        azureRegionInput,
        whisperCommandInput,
        whisperModelInput,
        whisperLanguageInput,
        whisperDeviceSelect,
        whisperCaptureModeSelect,
        whisperResponseTargetSelect,
        whisperSegmentMsInput,
        geminiKeyInput,
        windowGapInput
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveSettings);
            input.addEventListener('blur', saveSettings);
        }
    });

    if (speechProviderSelect) {
        speechProviderSelect.addEventListener('change', () => {
            updateSpeechFieldStates();
            saveSettings();
        });
    }

    // Language selection handler
    if (codingLanguageSelect) {
        codingLanguageSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            // use electronAPI so main broadcast is consistent
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ codingLanguage: lang });
            } else {
                // fallback
                saveSettings();
            }
        });
    }

    // Skill selection handler
    if (activeSkillSelect) {
        activeSkillSelect.addEventListener('change', (e) => {
            updateCustomSkillVisibility();
            saveSettings();
            // Also update the main window
            window.api.send('update-skill', e.target.value);
        });
	}

	// Profile selection handler
    if (activeProfileSelect) {
		activeProfileSelect.addEventListener('change', () => {
        saveSettings();
    });
    }

    const saveAppearance = () => {
        if (windowOpacityValue) windowOpacityValue.textContent = `${windowOpacityInput.value}%`;
        if (responseFontSizeValue) responseFontSizeValue.textContent = `${responseFontSizeInput.value}px`;
        window.electronAPI.saveSettings({
            windowOpacity: Number(windowOpacityInput.value) / 100,
            responseFontSize: Number(responseFontSizeInput.value),
            responseTextColor: responseTextColorInput.value,
            responseBackgroundColor: responseBackgroundColorInput.value
        });
    };

    const updateCustomSkillVisibility = () => {
        if (!customSkillRow) return;
        customSkillRow.style.display = activeSkillSelect && activeSkillSelect.value === 'custom'
            ? ''
            : 'none';
    };

    const populateSkillSelect = (select, items, savedValue, emptyLabel) => {
        populatePromptSelect(select, items, savedValue, emptyLabel);
        if (!select) return;
        select.appendChild(new Option('Custom...', 'custom'));
        if (savedValue === 'custom') select.value = 'custom';
        updateCustomSkillVisibility();
    };
    [windowOpacityInput, responseFontSizeInput, responseTextColorInput, responseBackgroundColorInput].forEach(input => {
        if (input) input.addEventListener('input', saveAppearance);
    });
    if (resetAppearanceButton) {
        resetAppearanceButton.addEventListener('click', () => {
            windowOpacityInput.value = '100';
            responseFontSizeInput.value = '14';
            responseTextColorInput.value = '#ffffff';
            responseBackgroundColorInput.value = '#111827';
            saveAppearance();
        });
    }

    updateSpeechFieldStates();

    // Initialize icon grid with correct paths
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity', src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings', src: './assests/icons/settings.png' }
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const iconElement = document.createElement('div');
            iconElement.className = 'icon-option';
            iconElement.dataset.icon = icon.key;
            
            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = icon.name;
            img.onload = () => {
                logger.info('Icon loaded successfully:', icon.src);
            };
            img.onerror = () => {
                console.error('Failed to load icon:', icon.src);
                // Try alternative paths
                const altPaths = [
                    `./assests/${icon.key}.png`,
                    `./assets/icons/${icon.key}.png`,
                    `./assets/${icon.key}.png`
                ];
                
                let pathIndex = 0;
                const tryNextPath = () => {
                    if (pathIndex < altPaths.length) {
                        img.src = altPaths[pathIndex];
                        pathIndex++;
                    } else {
                        img.style.display = 'none';
                        console.error('All icon paths failed for:', icon.key);
                    }
                };
                
                img.onload = () => {
                    logger.info('Icon loaded with alternative path:', img.src);
                };
                
                img.onerror = tryNextPath;
                tryNextPath();
            };
            
            const label = document.createElement('div');
            label.textContent = icon.name;
            
            iconElement.appendChild(img);
            iconElement.appendChild(label);
            
            // Click handler for icon selection
            iconElement.addEventListener('click', () => {                
                // Remove selection from all icons
                iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                // Add selection to clicked icon
                iconElement.classList.add('selected');
                
                // Save the selection - this should trigger the app icon change
                window.api.send('save-settings', { selectedIcon: icon.key });
                
                // Show visual feedback
                iconElement.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    iconElement.style.transform = 'scale(1)';
                }, 100);
            });
            
            iconGrid.appendChild(iconElement);
        });
    };

    // Initialize icon grid
    initializeIconGrid();

    // Request settings on load
    setTimeout(() => {
        requestCurrentSettings();
    }, 200);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.api.send('close-settings');
        }
    });
}); 
