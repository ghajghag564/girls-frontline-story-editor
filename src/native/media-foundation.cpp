#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <mfreadwrite.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <fcntl.h>
#include <io.h>
#include <memory>
#include <vector>

namespace {

constexpr DWORD sampleRate = 48000;
constexpr DWORD channels = 2;
constexpr LONGLONG ticksPerSecond = 10000000;

template <typename T>
class Com {
public:
    Com() = default;
    Com(const Com&) = delete;
    Com& operator=(const Com&) = delete;
    ~Com() { if (value_) value_->Release(); }
    T* get() const { return value_; }
    T* operator->() const { return value_; }
    T** receive() { return &value_; }
private:
    T* value_ = nullptr;
};

struct Failure {
    const char* operation;
    HRESULT result;
};

void check(HRESULT result, const char* operation) {
    if (FAILED(result)) throw Failure{operation, result};
}

class MediaSession {
public:
    MediaSession() {
        check(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "initialize COM");
        const HRESULT result = MFStartup(MF_VERSION);
        if (FAILED(result)) CoUninitialize();
        check(result, "initialize Windows Media Foundation");
    }
    ~MediaSession() {
        MFShutdown();
        CoUninitialize();
    }
};

using File = std::unique_ptr<FILE, decltype(&std::fclose)>;

File openFile(const wchar_t* file, const wchar_t* mode) {
    File handle(_wfopen(file, mode), &std::fclose);
    if (!handle) throw Failure{"open media file", HRESULT_FROM_WIN32(GetLastError() ? GetLastError() : ERROR_OPEN_FAILED)};
    return handle;
}

struct Video {
    bool hevc;
    DWORD width;
    DWORD height;
    DWORD fps;
    DWORD bitrate;
    DWORD frames;
    bool hardware;
};

DWORD number(const wchar_t* text, DWORD limit) {
    if (text[0] < L'1' || text[0] > L'9') throw Failure{"read numeric argument", E_INVALIDARG};
    wchar_t* end = nullptr;
    errno = 0;
    const unsigned long value = std::wcstoul(text, &end, 10);
    if (*end || errno == ERANGE || value > limit) throw Failure{"read numeric argument", E_INVALIDARG};
    return static_cast<DWORD>(value);
}

bool named(const wchar_t* argument, const wchar_t* value) {
    return std::wcscmp(argument, value) == 0;
}

Video videoOptions(wchar_t** argv) {
    if ((!named(argv[2], L"h264") && !named(argv[2], L"h265")) ||
        (!named(argv[10], L"hardware") && !named(argv[10], L"software"))) {
        throw Failure{"read video options", E_INVALIDARG};
    }
    Video v{named(argv[2], L"h265"), number(argv[3], 3840), number(argv[4], 2160),
        number(argv[5], 60), number(argv[6], 150000000), number(argv[7], 1296000),
        named(argv[10], L"hardware")};
    if ((v.height != 720 && v.height != 1080 && v.height != 1440 && v.height != 2160) ||
        v.width * 9 != v.height * 16 || (v.fps != 24 && v.fps != 30 && v.fps != 60)) {
        throw Failure{"read frame size or rate", E_INVALIDARG};
    }
    return v;
}

const GUID& outputFormat(bool hevc) {
    return hevc ? MFVideoFormat_HEVC : MFVideoFormat_H264;
}

bool hasEncoder(const GUID& format) {
    const MFT_REGISTER_TYPE_INFO output{MFMediaType_Video, format};
    IMFActivate** entries = nullptr;
    UINT32 count = 0;
    check(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_ALL, nullptr,
        &output, &entries, &count), "enumerate video encoders");
    for (UINT32 i = 0; i < count; ++i) entries[i]->Release();
    CoTaskMemFree(entries);
    return count != 0;
}

void setVideoType(IMFMediaType* type, REFGUID format, const Video& v) {
    check(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video), "set video major type");
    check(type->SetGUID(MF_MT_SUBTYPE, format), "set video format");
    check(type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive), "set scan mode");
    check(MFSetAttributeSize(type, MF_MT_FRAME_SIZE, v.width, v.height), "set frame size");
    check(MFSetAttributeRatio(type, MF_MT_FRAME_RATE, v.fps, 1), "set frame rate");
    check(MFSetAttributeRatio(type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1), "set pixel aspect ratio");
    check(type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709), "set YUV matrix");
    check(type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709), "set video primaries");
    check(type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709), "set transfer function");
    check(type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235), "set video range");
}

void setAudioType(IMFMediaType* type, REFGUID format) {
    check(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio), "set audio major type");
    check(type->SetGUID(MF_MT_SUBTYPE, format), "set audio format");
    check(type->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16), "set audio bits");
    check(type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, channels), "set channel count");
    check(type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, sampleRate), "set sample rate");
}

class Mp4Writer {
public:
    Mp4Writer(const wchar_t* file, const Video& video, bool audio) {
        Com<IMFAttributes> attrs;
        check(MFCreateAttributes(attrs.receive(), 3), "create writer attributes");
        if (video.hardware) {
            check(attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE), "enable hardware transforms");
        }
        check(attrs->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE), "disable real-time writer throttling");
        check(MFCreateSinkWriterFromURL(file, nullptr, attrs.get(), writer_.receive()), "create MP4 writer");

        Com<IMFMediaType> input, output;
        check(MFCreateMediaType(output.receive()), "create video output type");
        setVideoType(output.get(), outputFormat(video.hevc), video);
        check(output->SetUINT32(MF_MT_AVG_BITRATE, video.bitrate), "set video bitrate");
        if (!video.hevc) {
            check(output->SetUINT32(MF_MT_MPEG2_PROFILE, 100), "set H.264 High profile");
        }
        check(writer_->AddStream(output.get(), &videoStream_), "add compressed video stream");
        check(MFCreateMediaType(input.receive()), "create video input type");
        setVideoType(input.get(), MFVideoFormat_NV12, video);
        check(writer_->SetInputMediaType(videoStream_, input.get(), nullptr), "connect video encoder");
        if (audio) openAudio();
        check(writer_->BeginWriting(), "start MP4 encoding");
    }

    void video(const BYTE* data, DWORD bytes, DWORD frame, DWORD fps) {
        write(videoStream_, data, bytes, frame, frame+1, fps);
    }

    void audio(const int16_t* data, DWORD frames, LONGLONG first) {
        write(audioStream_, data, frames*channels*sizeof(int16_t), first, first+frames, sampleRate);
    }

    void finish() {
        check(writer_->Finalize(), "finalize MP4");
    }

private:
    void openAudio() {
        Com<IMFMediaType> input, output;
        check(MFCreateMediaType(output.receive()), "create audio output type");
        setAudioType(output.get(), MFAudioFormat_AAC);
        check(output->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24000), "set AAC bitrate");
        check(writer_->AddStream(output.get(), &audioStream_), "add AAC stream");

        check(MFCreateMediaType(input.receive()), "create audio input type");
        setAudioType(input.get(), MFAudioFormat_PCM);
        constexpr DWORD block = channels*sizeof(int16_t);
        check(input->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, block), "set PCM block size");
        check(input->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, sampleRate*block), "set PCM byte rate");
        check(writer_->SetInputMediaType(audioStream_, input.get(), nullptr), "connect AAC encoder");
    }

    void write(DWORD stream, const void* data, DWORD bytes, LONGLONG first, LONGLONG end, DWORD rate) {
        Com<IMFSample> sample;
        Com<IMFMediaBuffer> buffer;
        check(MFCreateSample(sample.receive()), "create sample");
        check(MFCreateMemoryBuffer(bytes, buffer.receive()), "create sample buffer");
        BYTE* target = nullptr;
        check(buffer->Lock(&target, nullptr, nullptr), "lock sample buffer");
        std::memcpy(target, data, bytes);
        check(buffer->Unlock(), "unlock sample buffer");
        check(buffer->SetCurrentLength(bytes), "set sample length");
        check(sample->AddBuffer(buffer.get()), "attach sample buffer");
        const LONGLONG time = first*ticksPerSecond/rate;
        check(sample->SetSampleTime(time), "set sample timestamp");
        check(sample->SetSampleDuration(end*ticksPerSecond/rate-time), "set sample duration");
        check(writer_->WriteSample(stream, sample.get()), "write encoded stream");
    }

    Com<IMFSinkWriter> writer_;
    DWORD videoStream_ = 0;
    DWORD audioStream_ = 0;
};

// Convert sRGB canvas pixels to 4:2:0 limited-range video with BT.709 coefficients.
void toNv12(const BYTE* rgba, BYTE* nv12, const Video& v) {
    BYTE* chroma = nv12+v.width*v.height;
    for (DWORD row = 0; row < v.height; row += 2) {
        for (DWORD col = 0; col < v.width; col += 2) {
            const DWORD i = row*v.width+col;
            int red = 0, green = 0, blue = 0;
            for (DWORD offset : {0UL, 1UL, v.width, v.width+1}) {
                const BYTE* pixel = rgba+4*(i+offset);
                const int r = pixel[0], g = pixel[1], b = pixel[2];
                nv12[i+offset] = static_cast<BYTE>(16+((47*r+157*g+16*b+128)>>8));
                red += r;
                green += g;
                blue += b;
            }
            *chroma++ = static_cast<BYTE>(128+((-26*red-87*green+112*blue+512)>>10));
            *chroma++ = static_cast<BYTE>(128+((112*red-102*green-10*blue+512)>>10));
        }
    }
}

void encoder(const Video& video, const wchar_t* filename, const wchar_t* musicPath, bool probe) {
    const bool audio = !named(musicPath, L"-");
    File music(nullptr, &std::fclose);
    if (audio && !probe) music = openFile(musicPath, L"rb");
    Mp4Writer writer(filename, video, audio);
    const DWORD pixels = video.width*video.height;
    std::vector<BYTE> rgba(probe ? 0 : pixels*4);
    std::vector<BYTE> nv12(pixels+pixels/2, 128);
    std::fill(nv12.begin(), nv12.begin()+pixels, 32);
    const DWORD perFrame = sampleRate/video.fps;
    std::vector<float> mixed(audio ? perFrame*channels : 0);
    std::vector<int16_t> pcm(mixed.size(), 0);
    LONGLONG firstSample = 0;
    for (DWORD i = 0; i < video.frames; ++i) {
        if (!probe) {
            if (std::fread(rgba.data(), 1, rgba.size(), stdin) != rgba.size()) {
                throw Failure{"read a complete RGBA frame", HRESULT_FROM_WIN32(ERROR_HANDLE_EOF)};
            }
            toNv12(rgba.data(), nv12.data(), video);
        }
        writer.video(nv12.data(), static_cast<DWORD>(nv12.size()), i, video.fps);

        if (audio) {
            size_t count = mixed.size();
            if (!probe) {
                constexpr size_t frameBytes = channels*sizeof(float);
                const size_t bytes = std::fread(mixed.data(), 1, mixed.size()*sizeof(float), music.get());
                if (std::ferror(music.get()) || bytes%frameBytes) throw Failure{"read PCM mix", E_FAIL};
                count = bytes/sizeof(float);
                for (size_t j = 0; j < count; ++j) {
                    const float v = std::isfinite(mixed[j]) ? mixed[j] : 0;
                    pcm[j] = static_cast<int16_t>(std::clamp(std::lround(v*32768.0f), -32768L, 32767L));
                }
            }
            if (count != 0) {
                const auto frames = static_cast<DWORD>(count/channels);
                writer.audio(pcm.data(), frames, firstSample);
                firstSample += frames;
            }
        }
    }
    // Wait for the input pipe to close: the parent commits its last frame before EOF.
    if (!probe && (std::fgetc(stdin) != EOF || std::ferror(stdin))) {
        throw Failure{"verify the video frame count", E_FAIL};
    }
    if (music && (firstSample == 0 || std::fgetc(music.get()) != EOF || std::ferror(music.get()))) {
        throw Failure{"verify the audio sample count", E_FAIL};
    }
    writer.finish();
}

DWORD pcmBits(IMFSourceReader* reader) {
    Com<IMFMediaType> type;
    check(reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, type.receive()), "read decoded media type");
    GUID format{};
    UINT32 rate = 0, count = 0, bits = 0;
    check(type->GetGUID(MF_MT_SUBTYPE, &format), "read PCM format");
    check(type->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &rate), "read PCM rate");
    check(type->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &count), "read PCM channels");
    check(type->GetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, &bits), "read PCM bit depth");
    if (format != MFAudioFormat_PCM || rate != sampleRate || count != channels ||
        (bits != 16 && bits != 24 && bits != 32)) {
        throw Failure{"verify stereo 48 kHz PCM output", MF_E_INVALIDMEDIATYPE};
    }
    return bits;
}

float pcmValue(const BYTE* sample, DWORD bytes) {
    uint32_t words = 0;
    std::memcpy(&words, sample, bytes);
    const auto value = static_cast<int32_t>(words << (32-8*bytes));
    return static_cast<float>(value)/2147483648.0f;
}

void decodeFlac(const wchar_t* filename, const wchar_t* target) {
    Com<IMFSourceReader> reader;
    check(MFCreateSourceReaderFromURL(filename, nullptr, reader.receive()), "open FLAC file");
    check(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE), "clear selected streams");
    check(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE), "select audio stream");
    Com<IMFMediaType> type;
    check(MFCreateMediaType(type.receive()), "create PCM type");
    check(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio), "set decoded major type");
    check(type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM), "set decoded PCM format");
    check(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, type.get()), "connect FLAC decoder");
    const DWORD sampleBytes = pcmBits(reader.get())/8;
    File output = openFile(target, L"wb");
    std::vector<float> floats;
    DWORD flags = 0;
    do {
        Com<IMFSample> sample;
        check(reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, nullptr, sample.receive()), "decode FLAC");
        if (flags & MF_SOURCE_READERF_ERROR) throw Failure{"read FLAC stream", E_FAIL};
        if ((flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) && pcmBits(reader.get())/8 != sampleBytes) {
            throw Failure{"verify decoded PCM format", MF_E_INVALIDMEDIATYPE};
        }
        if (!sample.get()) continue;
        Com<IMFMediaBuffer> data;
        check(sample->ConvertToContiguousBuffer(data.receive()), "make PCM buffer contiguous");
        DWORD bytes = 0;
        check(data->GetCurrentLength(&bytes), "read PCM length");
        if (bytes % (sampleBytes*channels)) throw Failure{"verify decoded buffer length", E_FAIL};
        floats.resize(bytes/sampleBytes);
        BYTE* pcm = nullptr;
        check(data->Lock(&pcm, nullptr, nullptr), "lock PCM buffer");
        for (size_t i = 0; i < floats.size(); ++i) floats[i] = pcmValue(pcm+i*sampleBytes, sampleBytes);
        check(data->Unlock(), "unlock PCM buffer");
        if (std::fwrite(floats.data(), sizeof(float), floats.size(), output.get()) != floats.size()) {
            throw Failure{"write float PCM", E_FAIL};
        }
    } while (!(flags & MF_SOURCE_READERF_ENDOFSTREAM));
    if (std::fclose(output.release()) != 0) throw Failure{"flush float PCM", E_FAIL};
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    try {
        MediaSession session;
        if (argc == 2 && named(argv[1], L"list")) {
            if (hasEncoder(MFVideoFormat_H264)) std::puts("h264");
            if (hasEncoder(MFVideoFormat_HEVC)) std::puts("h265");
        } else if (argc == 4 && named(argv[1], L"decode")) {
            decodeFlac(argv[2], argv[3]);
        } else if (argc == 11 && (named(argv[1], L"encode") || named(argv[1], L"probe"))) {
            const auto video = videoOptions(argv);
            if (_setmode(_fileno(stdin), _O_BINARY) == -1) throw Failure{"set video input to binary", E_FAIL};
            encoder(video, argv[8], argv[9], named(argv[1], L"probe"));
        } else {
            throw Failure{"read command", E_INVALIDARG};
        }
        return 0;
    } catch (const Failure& error) {
        std::fprintf(stderr, "%s (0x%08lx)\n", error.operation, static_cast<unsigned long>(error.result));
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s\n", error.what());
    }
    return 1;
}

