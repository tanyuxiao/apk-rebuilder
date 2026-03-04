from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


TaskStatus = Literal['queued', 'processing', 'success', 'failed']


@dataclass
class ApkInfo:
    appName: str
    packageName: str
    versionName: str
    versionCode: str
    appLabelRaw: str
    iconRef: str
    iconUrl: str | None = None


@dataclass
class UnityPatch:
    path: str
    value: Any


@dataclass
class ModPayload:
    appName: str | None = None
    packageName: str | None = None
    versionName: str | None = None
    versionCode: str | None = None
    iconUploadPath: str | None = None
    unityConfigPath: str | None = None
    unityPatches: list[UnityPatch] = field(default_factory=list)


@dataclass
class Task:
    id: str
    status: TaskStatus
    filePath: str
    workDir: str
    createdAt: str
    updatedAt: str
    logs: list[str] = field(default_factory=list)
    error: str | None = None
    decodedDir: str | None = None
    unsignedApkPath: str | None = None
    alignedApkPath: str | None = None
    signedApkPath: str | None = None
    iconFilePath: str | None = None
    apkInfo: ApkInfo | None = None
