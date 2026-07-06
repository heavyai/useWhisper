// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

const default_config = {
    endpoint: 'https://api.openai.com/v1/audio//transcriptions'
};

export default function useWhisper(config) {
    const {
        apiKey,
        endpoint,
        prompt,
        response_format,
        temperature,
        language,
        fetchConfig
    } = {
        ...default_config,
        ...config
    };

    const chunks = useRef([]);
    const stream = useRef(null);
    const media_recorder = useRef(null);

    const [recording, setRecording] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [transcript, setTranscript] = useState('');

    useEffect(() => {
        return () => {
            if (chunks.current.length) {
                chunks.current = [];
            }
            if (media_recorder.current) {
                media_recorder.current.stop();
            }
            if (stream.current) {
                stream.current.getTracks().forEach(track => track.stop());
                stream.current = null;
            }
        }
    }, []);

    const transcribe = useCallback(async file => {
        const body = new FormData();
        body.append('model', 'whisper-1');
        if (prompt) {
            body.append('prompt', prompt);
        }
        if (response_format) {
            body.append('response_format', response_format);
        }
        if (temperature) {
            body.append('temperature', temperature);
        }
        body.append('language', language ?? 'en');
        body.append('file', file);

        const defaultFetchConfig = {
            method: 'POST',
            headers: {
                ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
            }
        }

        const response = await fetch(endpoint, {
            ...defaultFetchConfig,
            ...fetchConfig,
            body
        });

        if (response.ok) {
            try {
                return (await response.json()).text;
            } catch (err) {
                console.error('Failed to parse reply from server', err);
                return '';
            }
        }
        return '';
    }, [apiKey, endpoint, prompt, response_format, temperature]);

    const startRecording = async () => {
        try {
            if (!stream.current) {
                // NOTE: This is letting the web browser choose the media
                // device based on the OS settings. Alternatively, we can find
                // all available devices and enumerate them for the user.
                stream.current = await navigator.mediaDevices.getUserMedia({
                    audio: true, video: false
                });

                if (!stream.current) {
                    throw new Error('Could not acquire user media stream');
                }
            }

            if (!media_recorder.current) {
                media_recorder.current = new MediaRecorder(stream.current);

                media_recorder.current.addEventListener('dataavailable', (a) => {
                    if (a.data.size > 0) {
                        chunks.current.push(a.data);
                    }
                });

                media_recorder.current.addEventListener('start', () => {
                    setRecording(true);
                });
            }

            chunks.current = [];
            media_recorder.current.start();
        } catch (err) {
            console.error('Failed to start recording', err);
        }
    };

    const pauseRecording = () => {
        if (media_recorder.current?.state === 'recording') {
            media_recorder.current.pause();
        } else if (media_recorder.current?.state === 'paused') {
            media_recorder.current.resume();
        }
    };

    const stopRecording = async () => {
        if (media_recorder.current) {
            await new Promise((resolve) => {
                media_recorder.current.addEventListener('stop', () => {
                    setRecording(false);
                    resolve();
                });
                media_recorder.current.stop();
            });
            media_recorder.current = null;
        }

        if (chunks.current.length) {
            const content_type = chunks.current[0].type;
            const data = new Blob([...chunks.current], { type: content_type });
            const extension = ((ct) => {
                switch (ct) {
                case 'audio/wav':
                    return 'wav';
                case 'audio/mp4':
                    return 'mp4';
                case 'x-opus+ogg':
                    return 'ogg';
                case 'audio/ogg; codecs=opus':
                    return 'ogg';
                case 'audio/webm;codecs=opus':
                    return 'webm';
                default:
                    return undefined;
                }
            })(content_type);

            if (!extension) {
                throw new Error('Unsupported Content-Type');
            }
            const file = new File([data], `speech.${extension}`, { type: content_type });
            chunks.current = [];

            setTranscribing(true);
            setTranscript(await transcribe(file));
            setTranscribing(false);
        }
    };

    return {
        recording,
        transcribing,
        transcript,
        startRecording,
        pauseRecording,
        stopRecording,
    };
}
