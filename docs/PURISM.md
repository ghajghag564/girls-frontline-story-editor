# Purism Core 1.1.0

人物模块通过 Koffi 调用 Sakura Motion Purism Core 的公开 v6 ABI。Windows x64 可使用可信的 1.1.0 v6 DLL，或从下面固定提交构建。兼容补丁处理只有一个取值的模型参数轴，补丁及其上游上下文采用 MIT。 [固定版本许可](https://github.com/SakuraMotion/PurismCore/blob/1069334965522df5d0b791e97f01e26b19c45456/LICENSE) · [补丁许可](../third-party/purism-core/LICENSE)

补丁涉及上游的 `src/verify.h`、`src/verify.c`、`src/model.c` 和 `src/param.c`。改动让参数轴只有一个键时的模型校验、内存分配和插值使用一致的组合容量。补丁头列有上游提交和版权行。 [补丁原文](../third-party/purism-core/single-key-compat.patch) · [许可范围](../LICENSE_SCOPE.md)

人物绘制使用固定上游 v6 ABI 的四个 drawable 标志值。数值 1 表示加色混合，2 表示乘色混合，4 表示双面绘制，8 表示反向遮罩。 [Purism Core 标志定义](https://github.com/SakuraMotion/PurismCore/blob/1069334965522df5d0b791e97f01e26b19c45456/include/PurismCore.h#L128-L138)

以下命令使用 Windows x64 MinGW GCC、CMake 和 Ninja。在源码根目录执行，`PurismCore` 可放在单独的本地工作目录中。新建时请把依赖源代码留在编辑器源码目录之外。

```powershell
$patch = (Resolve-Path -LiteralPath './third-party/purism-core/single-key-compat.patch').Path
$purism = 'C:/GFSE-local/PurismCore'
git clone https://github.com/SakuraMotion/PurismCore.git $purism
git -C $purism checkout 1069334965522df5d0b791e97f01e26b19c45456
git -C $purism apply --check -- $patch
git -C $purism apply -- $patch
$sourceBuild = @(
  '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_COMPILER=gcc', '-DBUILD_SHARED_LIBS=ON',
  '-DPURISM_CORE_ABI=v6', '-DPURISM_CORE_VERSION_RC=OFF', '-DPURISM_CORE_BUILD_SAMPLES=OFF',
  '-DPURISM_CORE_BUILD_TESTS=OFF', '-DPURISM_CORE_BUILD_VIEWER=OFF',
  '-DPURISM_CORE_GIT_HASH=1069334965522df5d0b791e97f01e26b19c45456+single-key'
)
cmake -S $purism -B (Join-Path $purism 'build') -G Ninja @sourceBuild
cmake --build (Join-Path $purism 'build') --target PurismCore
```

将生成的 `build/PurismCore.dll` 路径填入配置的 `purismCore`。这套源码验收使用应用补丁后重新编译的 DLL。 [固定提交的公开 ABI 声明](https://github.com/SakuraMotion/PurismCore/blob/1069334965522df5d0b791e97f01e26b19c45456/include/PurismCore.h)
