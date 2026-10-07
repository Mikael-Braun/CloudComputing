# ☁️ Cloud Computing

> Academic work developed for the **Cloud Computing** course of the Master's Degree in Informatics Engineering at **ISLA Gaia**.

---

## 📑 Table of Contents

* [Overview](#-overview)
* [Objectives](#-objectives)
* [Cloud Areas](#-cloud-areas)
* [Research Assignment](#-research-assignment)
* [Practical Project](#-practical-project)
* [Technologies & Tools](#-technologies--tools)
* [Security & Compliance](#-security--compliance)
* [Repository Structure](#-repository-structure)

---

## ☁️ Overview

This repository contains the **academic work, research and practical projects** developed for the Cloud Computing course.

The course focuses on cloud architectures, cloud service models, cloud-native development, security, automation, orchestration and emerging cloud technologies.

The practical work emphasizes the development and deployment of **cloud-based applications using managed services, authentication, databases, security rules and automated deployment pipelines**.

---

## 🎯 Objectives

* Understand **Cloud Computing** fundamentals and service models.
* Work with **IaaS, PaaS, SaaS and FaaS** architectures.
* Deploy and manage cloud resources.
* Develop **cloud-native applications**.
* Apply cloud security and access-control principles.
* Automate deployment and infrastructure management.
* Explore emerging technologies and trends in cloud computing.

---

## 🌐 Cloud Areas

### ☁️ Cloud Fundamentals

* Cloud Computing concepts and evolution
* Deployment models
* IaaS / PaaS / SaaS / FaaS
* Virtualization

### 🏗️ Cloud Infrastructure

* AWS
* Microsoft Azure
* Google Cloud
* Cloud storage and resource management
* Docker
* Kubernetes

### 🚀 Cloud-Native Development

* Microservices
* Serverless architectures
* Backend-as-a-Service
* Edge Computing
* Application monitoring

### 🔐 Security & Compliance

* IAM and authentication
* Role-Based Access Control
* Data protection
* GDPR
* ISO 27001
* NIST frameworks

### ⚙️ Automation & DevOps

* Terraform
* Ansible
* GitHub Actions
* CI/CD
* Prometheus
* Grafana
* AWS CloudWatch

### 🔬 Emerging Technologies

* AI in the Cloud
* Big Data
* Quantum Computing
* Sustainable Cloud Computing
* FinOps
* Digital Sovereignty
* Confidential Computing

---

## 🔬 Research Assignment

A technical research project focused on the **critical analysis of an emerging cloud technology or trend**.

Topics may include:

* Generative AI as a Service
* Cloud infrastructure for AI
* Big Data and Data Lakes
* Quantum Computing as a Service
* Edge Computing
* Digital Sovereignty
* FinOps
* Confidential Computing
* Sustainable Cloud Computing

The research compares technical approaches, cloud service models, advantages, limitations, security considerations and provider strategies.  
The topic researched was **Generative AI as a Service**.  

Detailed research material is available in [`Research/`](./Research/).

---

## 🛠️ Practical Project

A **cloud-based web application** developed using managed cloud services and a serverless/BaaS approach.

### Main Components

* 🌐 **Firebase Hosting:** Web application hosting
* 🗄️ **Cloud Firestore:** Application database
* 🔑 **Firebase Authentication:** User authentication
* 🛡️ **Firestore Security Rules:** Authorization and data protection
* ⚙️ **GitHub Actions:** Automated deployment
* 🧪 **Firebase Local Emulator Suite:** Local development and security-rule testing

The application includes role-based access with:

```text
user
manager
```

The project is designed to operate within the **Firebase Spark free-tier limitations**, with no paid cloud services required.

Detailed implementation and deployment information is available in [`Project/`](./Project/).

---

## 🧰 Technologies & Tools

| Category               | Technologies                          |
| ---------------------- | ------------------------------------- |
| Cloud Providers        | AWS · Azure · Google Cloud            |
| BaaS                   | Firebase                              |
| Database               | Cloud Firestore                       |
| Authentication         | Firebase Authentication               |
| Hosting                | Firebase Hosting                      |
| Containers             | Docker                                |
| Orchestration          | Kubernetes                            |
| Infrastructure as Code | Terraform · Ansible                   |
| CI/CD                  | GitHub Actions                        |
| Monitoring             | Prometheus · Grafana · AWS CloudWatch |
| Development            | Git · GitHub                          |

---

## 🔐 Security & Compliance

Security is an important component of the practical and theoretical work developed in this repository.

Topics include:

* Identity and Access Management
* Authentication and authorization
* Role-Based Access Control
* Firestore Security Rules
* Data protection
* GDPR
* ISO 27001
* NIST security principles
* Cloud shared-responsibility model

Security configurations and rules are tested using the **Firebase Local Emulator Suite** where applicable.

---

## 📂 Repository Structure

```text
Cloud-Computing/
│
├── README.md
│
├── Research/
│   ├── README.md
│   ├── report/
│   └── presentation/
│
└── Project/
    ├── README.md
    ├── src/
    ├── firebase/
    ├── .github/
    │   └── workflows/
    └── docs/
```
## Authors 

Gustavo Silva 
Rubens Dias 
Pedro Teixeira 
Mikael Braun
