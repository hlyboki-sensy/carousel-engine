// cutout.swift — вирізає головний об'єкт із фото (той самий рушій Apple Vision,
// що робить «підняти об'єкт» на iPhone та в Прев'ю). Офлайн, без залежностей.
//
// Компіляція:  swiftc -O -o bin/cutout bin/cutout.swift
// Виклик:      ./bin/cutout <вхід.jpg> <вихід.png>
// Код виходу:  0 ок · 2 аргументи · 1 не читається · 3 об'єкт не знайдено · 4 рендер

import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: cutout <in> <out.png>\n".data(using: .utf8)!)
    exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let input = CIImage(contentsOf: inURL) else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
    exit(1)
}

let handler = VNImageRequestHandler(ciImage: input, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()

do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(4)
}

guard let result = request.results?.first, !result.allInstances.isEmpty else {
    FileHandle.standardError.write("no subject found\n".data(using: .utf8)!)
    exit(3)
}

do {
    // повний кадр (не обрізаний) — щоб вирізаний об'єкт лягав 1:1 поверх фото
    let masked = try result.generateMaskedImage(
        ofInstances: result.allInstances,
        from: handler,
        croppedToInstancesExtent: false
    )
    let ci = CIImage(cvPixelBuffer: masked)
    let ctx = CIContext()
    guard let cg = ctx.createCGImage(ci, from: ci.extent) else {
        FileHandle.standardError.write("cgimage failed\n".data(using: .utf8)!)
        exit(4)
    }
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("png encode failed\n".data(using: .utf8)!)
        exit(4)
    }
    try png.write(to: outURL)
    print(outURL.path)
    exit(0)
} catch {
    FileHandle.standardError.write("mask render failed: \(error)\n".data(using: .utf8)!)
    exit(4)
}
