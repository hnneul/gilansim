// 캐릭터 이미지 누끼 — 배경을 지우고 알파 채널 PNG로 저장한다.
//
// public/character/*.png 를 만든 도구다. macOS Vision 의 전경 마스크를 쓴다 —
// 미리보기 앱의 "배경 제거"와 같은 엔진이라 받을 것도, 의존성도 없다.
// 그림자처럼 경계가 흐린 부분도 알파로 부드럽게 빠진다 (색으로 잘라내면 여기가 테두리로 남는다).
//
// 쓰는 법 (원본 옆에 .png 로 떨어진다):
//   swift scripts/cutout.swift 원본1.jpeg 원본2.jpeg …
// 그다음 화면 크기에 맞춰 줄인다:
//   sips -Z 512 원본1.png --out public/character/exp1.png

import CoreImage
import Foundation
import Vision

let ctx = CIContext()

for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let input = CIImage(contentsOf: url) else {
    print("못 읽음: \(path)")
    exit(1)
  }

  let request = VNGenerateForegroundInstanceMaskRequest()
  let handler = VNImageRequestHandler(ciImage: input)
  try handler.perform([request])

  // 인스턴스가 여럿이면(캐릭터 + 그림자 등) 전부 합쳐 남긴다 — 하나만 고르면 부속이 잘린다
  guard let found = request.results?.first else {
    print("피사체를 못 찾음: \(path)")
    exit(1)
  }
  let masked = try found.generateMaskedImage(
    ofInstances: found.allInstances, from: handler, croppedToInstancesExtent: false)

  let out = url.deletingPathExtension().appendingPathExtension("png")
  try ctx.writePNGRepresentation(
    of: CIImage(cvPixelBuffer: masked), to: out, format: .RGBA8,
    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  print("만듦: \(out.path)")
}
