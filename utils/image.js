/**
 * 图片选择与编码（拍照识图用）
 *
 * 职责：把「用户拍/选的一张图」变成可以塞进云函数调用参数的 data URL。
 *
 * 为什么不用云存储中转：走 uniCloud.uploadFile 再取临时链接虽然更省请求体，
 * 但多一次上传 + 一次外部拉取，链路更长；而拍照识图是单次、低频的操作，
 * 直接内联 base64 更短更稳。代价是请求体有上限，因此这里做了**体积守卫**：
 * 先按压缩参数取图，超限再压一次，仍超限就明确报错，而不是让云端静默截断。
 *
 * 各端差异（统一封装在这里，调用方无需关心）：
 *  - 小程序 / App：uni.getFileSystemManager().readFile({ encoding: 'base64' })
 *  - H5：tempFilePath 是 blob: 地址，用 fetch → Blob → FileReader
 */

/** 单张图片的原始字节上限：600 KB（base64 后约 800 KB，留出云端请求体余量） */
export const MAX_IMAGE_BYTES = 600 * 1024

/**
 * 让用户拍照或从相册选一张图。
 * 用户主动取消时 resolve 空串——取消不是错误，调用方据此静默返回即可。
 *
 * @returns {Promise<string>} 本地临时文件路径，取消时为空串
 */
export function choosePhoto() {
	return new Promise((resolve) => {
		uni.chooseImage({
			count: 1,
			// 先让系统压一道，能省掉后续大部分二次压缩
			sizeType: ['compressed'],
			sourceType: ['camera', 'album'],
			success: (res) => {
				const path = (res && res.tempFilePaths && res.tempFilePaths[0]) || ''
				resolve(path)
			},
			fail: () => resolve('')
		})
	})
}

/** 把本地图片读成 base64 字符串（不含 data URL 前缀） */
function readBase64(filePath) {
	return new Promise((resolve, reject) => {
		const fsm = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
		if (fsm) {
			fsm.readFile({
				filePath,
				encoding: 'base64',
				success: (res) => resolve(String((res && res.data) || '')),
				fail: () => reject(new Error('读取图片失败，换一张试试'))
			})
			return
		}
		// H5：blob: 地址需要经 FileReader 转 base64
		if (typeof fetch === 'function' && typeof FileReader === 'function') {
			fetch(filePath)
				.then((response) => response.blob())
				.then((blob) => {
					const reader = new FileReader()
					reader.onload = () => {
						const result = String(reader.result || '')
						resolve(result.indexOf(',') === -1 ? '' : result.slice(result.indexOf(',') + 1))
					}
					reader.onerror = () => reject(new Error('读取图片失败，换一张试试'))
					reader.readAsDataURL(blob)
				})
				.catch(() => reject(new Error('读取图片失败，换一张试试')))
			return
		}
		reject(new Error('当前环境不支持读取图片'))
	})
}

/** 二次压缩。H5 不支持 compressImage，返回空串表示压不了 */
function compressPhoto(filePath, quality) {
	return new Promise((resolve) => {
		if (typeof uni.compressImage !== 'function') {
			resolve('')
			return
		}
		uni.compressImage({
			src: filePath,
			quality,
			success: (res) => resolve((res && res.tempFilePath) || ''),
			fail: () => resolve('')
		})
	})
}

/**
 * H5 端压缩：`uni.compressImage` 在 H5 不可用，改用 canvas 降采样。
 * 直接产出 data URL（而非临时文件路径），调用方按返回值形态分流。
 * 手机上直出的原图动辄 3~5 MB，不做这一步会一律撞体积上限。
 */
function compressInH5(filePath, quality, maxEdge) {
	return new Promise((resolve) => {
		if (typeof document === 'undefined' || typeof Image === 'undefined') {
			resolve('')
			return
		}
		const image = new Image()
		image.onload = () => {
			try {
				const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
				const canvas = document.createElement('canvas')
				canvas.width = Math.max(1, Math.round(image.width * scale))
				canvas.height = Math.max(1, Math.round(image.height * scale))
				canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
				resolve(canvas.toDataURL('image/jpeg', quality / 100))
			} catch {
				resolve('')
			}
		}
		image.onerror = () => resolve('')
		image.src = filePath
	})
}

/** base64 字符串对应的原始字节数（按补位符扣掉填充） */
function base64Bytes(base64) {
	const padding = (base64.match(/=+$/) || [''])[0].length
	return Math.floor((base64.length * 3) / 4) - padding
}

/** 从文件路径猜 MIME。猜不到时按 jpeg 处理——相机出图绝大多数是 jpeg */
function guessMime(filePath) {
	const match = String(filePath || '').toLowerCase().match(/\.(png|jpe?g|webp|gif|bmp)$/)
	if (!match) return 'image/jpeg'
	if (match[1] === 'jpg' || match[1] === 'jpeg') return 'image/jpeg'
	return `image/${match[1]}`
}

/**
 * 本地图片 → data URL。
 *
 * 超过体积上限时按 60 → 40 的力度递进压缩；仍超限则抛错，
 * 由调用方提示用户换一张小图，避免把超限数据发到云端。
 *
 * 压缩分两条实现：小程序 / App 走 `uni.compressImage`（产出临时文件路径，需重读），
 * H5 走 canvas 降采样（直接产出 data URL）。
 *
 * @param {string} filePath 本地临时文件路径
 * @returns {Promise<{dataUrl: string, bytes: number}>}
 */
export async function toImageDataUrl(filePath) {
	let path = filePath
	let base64 = await readBase64(path)
	let bytes = base64Bytes(base64)
	let mime = guessMime(path)

	for (const quality of [60, 40]) {
		if (bytes <= MAX_IMAGE_BYTES) break

		const compressedPath = await compressPhoto(path, quality)
		if (compressedPath) {
			path = compressedPath
			base64 = await readBase64(path)
			mime = guessMime(path)
		} else {
			const compressedUrl = await compressInH5(path, quality, 1280)
			if (!compressedUrl) break
			mime = 'image/jpeg'
			base64 = compressedUrl.slice(compressedUrl.indexOf(',') + 1)
		}
		bytes = base64Bytes(base64)
	}

	if (!base64) throw new Error('读取图片失败，换一张试试')
	if (bytes > MAX_IMAGE_BYTES) throw new Error('图片有点大，换一张小一点的试试')

	return { dataUrl: `data:${mime};base64,${base64}`, bytes }
}
